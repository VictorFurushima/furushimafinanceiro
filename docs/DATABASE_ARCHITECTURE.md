# Arquitetura de Dados — Furushima Financeiro

Documento permanente de referência para qualquer alteração de backend/dados.

## 1. Fonte de verdade

PostgreSQL (Supabase) é a **única fonte de verdade**. Nenhuma regra financeira
vive apenas no browser: cálculos, agregações e automações são responsabilidade
do banco.

## 2. Modelo multiusuário: admin / viewer e `space_owner`

- Papéis ficam em `public.user_roles` (`app_role`: `admin`, `viewer`) — nunca em
  `profiles` ou em qualquer tabela de usuário.
- `viewer` possui `owner_id` apontando para o admin dono do espaço.
- `public.space_owner(_user_id uuid)` resolve o dono do espaço:
  retorna `owner_id` quando o usuário é viewer, caso contrário o próprio id.
- Toda leitura agregada é escopada por `space_owner((select auth.uid()))`.

## 3. RLS

- RLS habilitada em todas as tabelas de `public`.
- Policies usam **subquery InitPlan**: `user_id = (select auth.uid())` — nunca
  `auth.uid()` direto, que é avaliado por linha.
- Toda `CREATE TABLE` em `public` vem acompanhada de `GRANT` no mesmo arquivo.
- Funções expostas ao cliente são `SECURITY INVOKER` + `STABLE` + `search_path`
  fixo. `SECURITY DEFINER` só quando não existe `auth.uid()` (jobs de cron) e,
  nesse caso, a função fica em schema `private`, sem `EXECUTE` para
  `anon`/`authenticated`/`public`.

## 4. Índices

- Índices são criados **orientados a queries reais**: filtros de tela, colunas
  de FK e colunas usadas pelas policies de RLS (`user_id`).
- Índices parciais `UNIQUE` garantem idempotência de rotinas recorrentes
  (ex.: `(user_id, recurring_id, occurred_at)` e
  `(user_id, source_recharge_id, expected_date)`).
- Não criar índice redundante (prefixo de índice composto já existente) nem
  índice "por precaução".

## 5. Agregações no PostgreSQL

Toda estatística é calculada por RPC `STABLE SECURITY INVOKER`:

| RPC | Uso |
| --- | --- |
| `get_financial_overview()` | KPIs globais e contexto do planejador |
| `get_monthly_financial_summary(from, to)` | Resumo de um período |
| `get_spending_by_category(from, to)` | Pizza de categorias |
| `get_account_balances()` | Saldos por conta (set-based) |
| `get_monthly_series(months)` | Série histórica de receitas/despesas |
| `get_statistics_extras(from, to, top)` | Dia da semana, meios de pagamento, top gastos |
| `get_dashboard_snapshot()` | Resumos compactos da tela inicial |

Regras:
- O owner é resolvido **uma vez por statement** com CTE `o AS (SELECT
  public.space_owner((select auth.uid())))`.
- Nunca chamar `space_owner(auth.uid())` dentro de joins ou por linha.
- Nada de agregação no browser sobre datasets completos.

## 6. Listagens e paginação

- `transactions` é sempre paginada no servidor (`range()` no PostgREST).
  O histórico completo nunca é carregado no browser.
- Ferramentas MCP também paginam (`limit` padrão 50, máx. 200, `page`/`offset`).
- `select('*')` é **proibido** em listagens do app; sempre colunas explícitas.
  Exceção somente com justificativa documentada no próprio código.

## 7. Jobs recorrentes

- Rodam no backend via `pg_cron`, nunca via `useEffect`/`localStorage`.
- Job único: `financial-daily-maintenance`, `10 6 * * *` UTC
  (≈ 03:10 America/Sao_Paulo), chamando
  `private.run_financial_daily_maintenance()`.
- A rotina é set-based (todos os owners de uma vez) e idempotente pelos índices
  `UNIQUE` parciais; retorna JSON de auditoria.

## 8. Checklist obrigatório de alteração

Ao criar tabela, relação ou filtro relevante, revisar **sempre**:

1. **FK** — a relação está declarada com `ON DELETE` correto?
2. **RLS** — policy criada, escopada por `(select auth.uid())`, e `GRANT` feito?
3. **Índice** — a coluna de filtro/FK/RLS está indexada, sem redundância?

## 9. Cache no cliente

- Query keys centralizadas em `src/lib/query-keys.ts`.
- Prefixo `["finance", ...]` cobre todos os agregados: invalidar `["finance"]`
  recalcula overview, séries, saldos e snapshot.
- Invalidação sempre via `invalidateFinance(qc, ...domínios)` — nunca
  `invalidateQueries` avulso espalhado por componentes.
- `QueryClient`: `staleTime` 60s, `gcTime` 10min, `refetchOnWindowFocus` false,
  `refetchOnReconnect` true, `retry` 1.

## Hub Pessoal (Agenda, Rotinas, Tarefas, Alertas)

Tabelas: `calendar_events`, `routines`, `routine_occurrences`, `tasks`, `alerts`,
`calendar_integrations`. Todas com RLS em padrão InitPlan
(`(select public.space_owner((select auth.uid())))` para leitura,
`(select public.is_admin((select auth.uid())))` para escrita).

### Origem dos eventos (`calendar_events.source_type`)

| source_type | Origem | Idempotência |
| --- | --- | --- |
| `null` | criado manualmente pelo usuário | — |
| `routine` | gerado por `materialize_routine_events` | `idx_calendar_events_routine_slot (user_id, source_id, starts_at)` |
| `credit_card_bill` | agendamento de pagamento de fatura (tela Cartões) | `idx_calendar_events_finance_source (user_id, source_type, source_id)` |

### Materialização de rotinas

`public.materialize_routine_events(p_days int)` é set-based e idempotente:
gera eventos das rotinas ativas em janela finita (máx. 60 dias) e remove eventos
futuros de rotinas pausadas/excluídas. É chamada ao salvar ou pausar uma rotina;
reexecutar não duplica registros.

### Status canônicos

- `routine_occurrences.status`: `pendente` | `concluida`
- `tasks.status`: `pendente` | `em_andamento` | `concluida` | `cancelada`
- `alerts.status`: `pending` | `read` | `dismissed`
- `calendar_events.sync_status`: `pending` | `synced` | `error`

Todos protegidos por `CHECK` constraints.

### Sincronização com Google Calendar

Unidirecional (Postgres -> Google), executada apenas em server functions
(`src/lib/calendar-sync.functions.ts`) com verificação explícita de
`public.is_admin`. Falha de envio nunca apaga dado local: o evento fica com
`sync_status='error'` e `sync_error` preenchido para retry manual.

## Agenda gerada (atualização)

- `idx_calendar_events_finance_source` cobre `source_type IN ('bill','credit_card_bill','recurring')`,
  garantindo idempotência do agendamento de faturas criado em `/cards`.
- `materialize_routine_events(p_days)` é convergente: além de inserir os slots da janela,
  remove eventos futuros de rotina que não correspondem mais aos `weekdays`/`start_time`/status atuais.
- Recorrência de compromissos (`recurrence_rule`) não é materializada no banco; a UI expande
  as repetições localmente apenas dentro do intervalo visualizado.
