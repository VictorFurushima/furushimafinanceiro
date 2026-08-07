# Auditoria técnica (somente leitura) — Furushima Financeiro

Nenhum arquivo foi alterado e nenhuma migration foi aplicada. Abaixo o diagnóstico com evidências e o SQL/índices recomendados (apenas propostos).

Nota de escala: hoje o banco tem volume mínimo (`transactions` 1 linha, `recurring_expenses` 12, demais ~0). Nada está lento *hoje*; os itens abaixo são dívidas que passam a doer a partir de alguns milhares de linhas.

## 1. Mapa das consultas

Leituras (React Query, todas via cliente browser com RLS):
- `src/hooks/use-finance-data.ts`: `transactions` (+join `categories`,`accounts`), `categories`, `accounts`, `budgets` (+join), `recurring_expenses` (+join), `goals`, `category_limits`, `balance_recharges`, `credit_cards`, `credit_card_bills` — todas `select("*")`, todas sem filtro de período.
- `src/hooks/use-app-data.ts`: `investments`, `investment_events`, `notes`, `shopping_items`, `user_settings`, RPC `list_my_viewers`.
- `src/hooks/use-role.ts`: `user_roles`.
- MCP (`src/lib/mcp/tools/*`): `list-accounts`, `list-transactions`, `list-recharges`, `list-credit-cards`, `list-upcoming-bills`, `financial-summary`, `create-transaction`.

Escritas/RPC: `_app.tsx` (3 RPCs de automação por dia), `pay_credit_card_bill`, `confirm_recharge_as_income`, `invest_contribute/redeem/update_value`, `grant/revoke_viewer_access`, além de inserts/updates/deletes diretos nos diálogos.

## 2. Severidade ALTA

**A1 — Políticas RLS chamam funções por linha.** Todas as policies usam `user_id = space_owner(auth.uid())` e `(user_id = auth.uid()) AND is_admin(auth.uid())` sem envolver em `(select ...)`. O Postgres não consegue transformar em InitPlan, então `space_owner`/`is_admin` (que fazem SELECT em `user_roles`) executam **uma vez por linha avaliada** em cada tabela. É o maior gargalo estrutural do schema — afeta 17 tabelas.
Correção recomendada: recriar cada policy usando `user_id = (select public.space_owner((select auth.uid())))` e `(user_id = (select auth.uid())) AND (select public.is_admin((select auth.uid())))`, e marcar `is_admin`/`space_owner` como `STABLE` (já são) — sem alterar semântica.

**A2 — Nenhum índice em `user_id` fora de `transactions` e `ocr_detected_transactions`.** Toda policy filtra por `user_id`; sem índice, cada leitura é seq scan + filtro por linha (agravado por A1). Índices ausentes:
```sql
CREATE INDEX ON public.accounts (user_id);
CREATE INDEX ON public.categories (user_id, type);
CREATE INDEX ON public.goals (user_id);
CREATE INDEX ON public.category_limits (user_id);
CREATE INDEX ON public.investments (user_id, status);
CREATE INDEX ON public.investment_events (user_id, occurred_at DESC);
CREATE INDEX ON public.investment_events (investment_id);
CREATE INDEX ON public.notes (user_id, note_date DESC);
CREATE INDEX ON public.shopping_items (user_id, status);
CREATE INDEX ON public.credit_cards (user_id);
CREATE INDEX ON public.credit_card_bills (user_id, due_date);
CREATE INDEX ON public.balance_recharges (user_id, expected_date);
CREATE INDEX ON public.balance_recharges (source_recharge_id) WHERE source_recharge_id IS NOT NULL;
CREATE INDEX ON public.recurring_expenses (user_id, status, billing_day);
CREATE INDEX ON public.budgets (user_id, month);
CREATE INDEX ON public.uploaded_transaction_images (user_id, upload_date DESC);
CREATE INDEX ON public.transactions (user_id, recurring_id) WHERE recurring_id IS NOT NULL; -- usado por generate_recurring_transactions
CREATE INDEX ON public.transactions (account_id);
CREATE INDEX ON public.transactions (category_id);
```
`transactions_user_date_idx (user_id, occurred_at DESC)` já cobre a listagem principal; nada redundante foi encontrado.

**A3 — `useTransactions()` sem limite carrega a tabela inteira e agrega no cliente.** `src/hooks/use-finance-data.ts:85` + consumidores em `dashboard.tsx`, `statistics.tsx`, `budgets.tsx`, `accounts.tsx`, `use-financial-context.ts`. Saldo, totais do mês, gastos por categoria e séries mensais são calculados em JS sobre todas as linhas. Recomendação: filtrar por período (`gte occurred_at`) nas telas de mês e mover os agregados para views/RPC (`monthly_summary(p_from, p_to)`, `category_spend(p_month)`), retornando dezenas de linhas em vez de milhares.

## 3. Severidade MÉDIA

**M1 — Sem `staleTime` global.** `src/router.tsx:6` cria `new QueryClient()` com defaults; `staleTime: 0` faz refetch em cada montagem/foco. Com ~10 hooks disparando em `dashboard`/`timeline`, isso multiplica requisições PostgREST. Sugerido: `defaultOptions.queries.staleTime` de 30–60s e `refetchOnWindowFocus: false`.

**M2 — Chaves de cache fragmentadas em `transactions`.** `useTransactions(limit)` gera `["transactions", 50]` e `["transactions","all"]`; `note-dialog.tsx:35` pede 50 enquanto a página pede tudo → duas requisições ao mesmo dataset. Unificar em uma chave com `select` derivado.

**M3 — `select("*")` em todas as leituras**, incluindo colunas nunca usadas (`notes`, `raw_text` em OCR, `created_at`). Projeção explícita reduz payload; crítico em `ocr_detected_transactions.raw_text`.

**M4 — Funções de automação chamadas a cada entrada no app.** `src/routes/_app.tsx:20-24` dispara três RPCs com loops `FOR ... LOOP` + `NOT EXISTS` por linha. `generate_recurring_transactions` faz um `EXISTS` em `transactions` por recorrência (sem o índice de A2), e `generate_recurring_recharges` idem. Alternativas: agendamento por `pg_cron` chamando rota `/api/public/*`, ou reescrita em `INSERT ... SELECT ... ON CONFLICT DO NOTHING` com índice único `(recurring_id, occurred_at)`.

**M5 — `complete_shopping_item` e `confirm_recharge_as_income` fazem `SELECT ... INTO` sem filtro `user_id`,** dependendo unicamente da RLS para escopo; funcionalmente correto hoje, mas frágil se a função virar `SECURITY DEFINER`. Adicionar `AND user_id = auth.uid()` explícito.

**M6 — `credit_card_bills` sem índice em `user_id` mas com unique `(card_id, month, year)`;** `pay_credit_card_bill` e `complete_shopping_item` buscam por `(card_id, month, year, user_id)` — a unique cobre, mas as leituras da tela ordenam por `due_date` sem índice.

## 4. Severidade BAIXA

- `useCategoryLimits` é carregado em `use-financial-context.ts:32` e nunca usado no cálculo (aparece só na lista de dependências) — requisição desperdiçada.
- `financial-summary` (MCP) repete no servidor a mesma agregação em JS feita no frontend; candidato natural à RPC agregada de A3.
- `is_admin` e `space_owner` são `SECURITY INVOKER` e leem `user_roles`; com o índice unique existente `(user_id, role)` o acesso é barato, mas o número de chamadas (A1) é o problema, não o custo unitário.
- `profiles` sem policy de DELETE (intencional) e `user_roles` somente leitura — consistente.

## 5. Migrations e consistência de schema

14 arquivos em `supabase/migrations/`, nomes gerados automaticamente (`<timestamp>_<uuid>.sql`), sem descrição no nome nem comentário de cabeçalho. Observações:
- Tamanhos muito desiguais: `20260804165418_...sql` tem 19,5 KB e mistura investimentos, notas, carrinho, papéis e políticas — um único diff impossível de revisar; ao lado dele há migrations de 85 e 173 bytes (ajustes soltos aplicados minutos depois da anterior), sinal de correção reativa em vez de mudança planejada.
- Pares `...181034` / `...181056` e `...174621` / `...174642` são claramente "migration + patch imediato" que deveriam ter sido uma só.
- Nenhuma migration cria índices além dos dois de `ocr_*` e `transactions_user_date_idx`, o que explica a lacuna do item A2.
- Não há migrations de rollback nem comentários `COMMENT ON TABLE/COLUMN`; o schema não é autodocumentado.

## 6. Git / commits

`git log` mostra 30 commits recentes em que a maioria é `Changes` (16 ocorrências) ou `Work in progress` (3). Apenas 6 têm mensagem descritiva (`Corrigiu FK para categorias e contas`, `Adicionou gestão de viewers`, `Corrigiu 7 SEO findings`). Consequência prática: impossível localizar quando um índice/política mudou, e mudanças de schema ficam misturadas com CSS e ajustes de UI no mesmo commit.

Padrão proposto (Conventional Commits com escopo de banco):
```text
db(schema): adiciona indices user_id em contas, metas e cartoes
db(rls): envolve auth.uid() em subselect nas policies de leitura
db(fn): reescreve generate_recurring_transactions com INSERT..SELECT
feat(recharges): tela de recargas usa RPC agregada
fix(cards): corrige baixa de limite ao pagar fatura
```
Regras sugeridas:
1. Uma migration por intenção; nunca "migration + patch" no mesmo dia — corrigir antes de aplicar.
2. Prefixo `db(...)` isolado: commit que toca `supabase/migrations/` não toca `src/` de UI.
3. Cabeçalho obrigatório no `.sql`: objetivo, tabelas afetadas, impacto em RLS/grants e plano de reversão.
4. `COMMENT ON` para toda tabela/coluna nova.
5. Índices sempre na mesma migration que cria a tabela ou a policy que os exige.

## Prioridade sugerida (nada aplicado)

1. A2 — índices `user_id` (baixo risco, ganho imediato quando o volume crescer).
2. A1 — reescrita das policies com subselect.
3. A3/M1/M2 — filtros por período, agregação no banco e cache do React Query.
4. M4 — mover automação para agendamento.
5. Padronização de commits/migrations.
