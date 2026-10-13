# Patch de 13/10/2026: auditoria completa (banco, back e front)

Data: 13/10/2026. Base: 97b3decc8dc444e647be4ec1fe2400102d74b392 (mesmo commit do Lovable).
Branch: `claude/furushima-audit-completo-a40zdy`.
Projeto: VictorFurushima/furushimafinanceiro, Lovable ec051308-bc31-4b3a-854d-14e500a89183.

## Resumo

Revisão integral do projeto, com o banco conferido **contra produção** (conector Lovable, somente
leitura, exceto a ação de dados autorizada descrita abaixo). Foram encontrados e corrigidos 4 problemas
no banco, 5 no front e 2 no back. Um deles já tinha afetado dados reais: o salário de outubro aparecia
em dobro na receita prevista.

| #   | Camada | Problema                                                                                                                                                                                                    | Situação em produção antes do patch                                                                                                                                    |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Banco  | O gerador de recarga recorrente criava uma cópia no mesmo mês do cadastro modelo (e até em meses anteriores ao início)                                                                                      | **Ocorreu**: Salário de 20/10, R$ 2.750, duplicado (modelo `confirmada` + cópia `prevista` criada pelo cron em 06/10). Painel e planejador contavam R$ 5.500 previstos |
| 2   | Banco  | Assinatura criada depois do dia de cobrança gerava uma cobrança com data anterior ao início                                                                                                                 | 0 casos (latente; 14 assinaturas)                                                                                                                                      |
| 3   | Banco  | Frequência legada `custom` gerava uma despesa por dia                                                                                                                                                       | 0 linhas (latente)                                                                                                                                                     |
| 4   | Banco  | "Hoje" calculado em UTC: entre 21h e 0h de Brasília, pagamento de fatura e recebimento ficavam com a data de amanhã, o painel virava o mês 3h antes e a fatura virava "atrasada" antes do fim do vencimento | Banco em `TimeZone=UTC` (confirmado); nenhum lançamento divergente até agora                                                                                           |
| 5   | Front  | Cartões, Assinaturas e Linha do tempo mostravam o vencimento do mês seguinte no próprio dia do vencimento; dia 31 transbordava em meses curtos                                                              | Código                                                                                                                                                                 |
| 6   | Front  | Linha do tempo exibia data e dia da semana **do dia anterior** e escondia eventos de hoje após 12h                                                                                                          | Código                                                                                                                                                                 |
| 7   | Front  | Metas apareciam "Atrasada" no dia do prazo; a "data segura" do planejador de compras aparecia um dia antes                                                                                                  | Código                                                                                                                                                                 |
| 8   | Front  | Reimportar o CSV exportado transformava "Transferência" e "Pagamento de fatura" em despesas novas (gasto em dobro); a coluna "Conta" exportada era ignorada; categoria casava só por nome                   | Código                                                                                                                                                                 |
| 9   | Front  | Contas e Receitas excluíam sem pedir confirmação (as demais telas pedem)                                                                                                                                    | Código                                                                                                                                                                 |
| 10  | Back   | MCP `financial_summary` usava o mês em UTC; consulta da Selic ao Banco Central sem timeout                                                                                                                  | Código                                                                                                                                                                 |

## Como a auditoria foi feita

1. **Linha de base**: TypeScript, build e as 4 suítes de integração existentes (97 verificações)
   passavam antes de qualquer mudança. ESLint só apontava formatação em arquivos gerados pelo Lovable.
2. **Banco**: o schema final foi reconstruído localmente em PGlite com as migrations reais
   (31 tabelas, 76 funções) e lido integralmente: funções, RLS, grants, triggers e cron.
3. **Produção** (conector Lovable): 45 migrations registradas, 3 jobs de cron ativos, banco em UTC,
   `anon` sem EXECUTE nas RPCs. As 14 funções críticas têm o mesmo hash da reconstrução local
   (3 diferem apenas por fim de linha CRLF). Contagens agregadas mediram o impacto de cada bug.
4. **Back e front**: server functions, OCR, MCP, integrações Supabase, hooks e todas as telas.

## Banco (2 migrations novas, nenhuma migration antiga editada)

### `20261013120000_fix_recurrence_generation.sql`

Recria `private.run_financial_daily_maintenance()`, `public.generate_recurring_transactions()` e
`public.generate_recurring_recharges()` a partir das definições vigentes, com três regras:

- **Recarga recorrente**: o próprio cadastro é a primeira ocorrência. O cron só cria cópias a partir do
  mês seguinte ao `expected_date` do modelo. Modelo com data futura não gera nada até começar.
- **Assinatura**: nenhuma cobrança com data anterior a `start_date`. Ex.: início 13/10, cobrança dia 5,
  primeira cobrança em 05/11 (antes: 05/10).
- **Frequência `custom`**: não tem agenda e deixa de ser gerada. A tela já não oferece essa opção.

Permissões preservadas e reafirmadas. Sem backfill.

### `20261013120100_pin_financial_functions_timezone.sql`

O banco continua em UTC (recomendação do Supabase). O fuso é fixado **na configuração de cada função**
(`SET timezone`), sem alterar corpo, assinatura ou retorno:

- **America/Sao_Paulo** em 13 funções de negócio: `run_financial_daily_maintenance`,
  `generate_recurring_transactions`, `generate_recurring_recharges`, `mark_overdue_recharges`,
  `get_financial_overview`, `get_dashboard_snapshot`, `get_dashboard_bundle`, `get_monthly_series`,
  `pay_credit_card_bill`, `confirm_recharge_as_income`, `validate_bill`, `invest_update_value`,
  `update_investment_details`.
- **UTC** em `private.capture_financial_action`, `private.financial_action_conflicts` e
  `public.revert_financial_action`. O Histórico de ações guarda as linhas como JSON e o horário vira
  texto no fuso ativo. Sem essa fixação, desfazer uma ação feita por uma função em horário de Brasília
  acusaria conflito (a regressão foi pega pelos testes de histórico e carteiras). Os 8 retratos
  existentes em produção estão em `+00:00`, portanto continuam válidos.

O cron diário (06:10 UTC = 03:10 em Brasília) continua processando o mesmo dia.

**Manutenção:** `CREATE OR REPLACE` de qualquer uma dessas funções remove o `SET timezone`. Quem recriar
uma delas deve reaplicar o fuso na mesma migration.

## Ação de dados em produção (autorizada pelo titular em 13/10)

```sql
UPDATE public.balance_recharges SET status='cancelada'
WHERE id='c4647e63-59b2-41ab-b2f8-1be99d025e33'
  AND source_recharge_id='eb09933a-9218-4b86-ab20-2db5a5cab13d' AND status='prevista';
```

Retornou 1 linha: a cópia do Salário de 20/10 (R$ 2.750), agora `cancelada`. O modelo `confirmada`
ficou intacto. A cópia cancelada sai dos totais e impede o cron de recriá-la. A alteração foi feita
sem sessão de usuário, por isso **não aparece no Histórico de ações**. Para reverter:
`UPDATE public.balance_recharges SET status='prevista' WHERE id='c4647e63-59b2-41ab-b2f8-1be99d025e33';`

## Front

- `src/lib/date-only.ts`: novo `nextMonthlyDateISO(dia, hoje)`. O dia do vencimento conta como
  próximo, e os dias 29 a 31 ficam limitados ao fim de meses curtos. Validado em 9 casos e 3 fusos.
- Cartões, Assinaturas e Linha do tempo usam o helper com `diffDaysISO` e `formatDateOnlyPtBR`.
- Linha do tempo compara datas `AAAA-MM-DD`: eventos de hoje permanecem, e o cabeçalho e o dia da
  semana ficam corretos.
- Metas: `diffDaysISO(hoje, prazo)`. Planejador de compras: `formatDateOnlyPtBR(dataSegura)`.
- Faturas zeradas (compras excluídas) saem da lista de pagamento em Cartões e da Linha do tempo.
- Importar CSV:
  - linhas com Tipo "Transferência" ou "Pagamento de fatura" são recusadas, com orientação de usar
    as telas de Transações ou Cartões;
  - a categoria precisa ser do mesmo tipo da linha;
  - a coluna opcional `Conta` vincula a conta pelo nome (a exportação já gera essa coluna);
  - conta inexistente vira erro na pré-visualização.
- Contas e Receitas pedem confirmação antes de excluir.

Arquivos gerados (`src/integrations/**`, rotas MCP auto-geradas) não foram editados.

## Back

- MCP `financial_summary`: o mês padrão vem de `todayISO()` (São Paulo), e o fim do mês é calculado
  sem depender do fuso do servidor.
- `getSelicRate`: `AbortSignal.timeout(10_000)` na consulta ao Banco Central.

## Verificação

| Verificação                                          | Resultado   |
| ---------------------------------------------------- | ----------- |
| `test:finance` (ledger)                              | 19 passaram |
| `test:import-installments`                           | 29 passaram |
| `test:history` (agora sobre as migrations novas)     | 27 passaram |
| `test:investments` (agora sobre as migrations novas) | 22 passaram |
| `test:recurrence` (nova)                             | 10 passaram |
| TypeScript (`tsc --noEmit`)                          | sem erros   |
| ESLint nos arquivos alterados                        | sem erros   |
| Build (`vite build`)                                 | ok          |

A suíte nova foi executada também **contra o schema anterior**. Os 7 checks dos bugs falharam (fuso,
cópia no mesmo mês, cópia antes do início, gerador legado, cobrança retroativa, `custom` diária e data
do pagamento). Os 3 checks de controle passaram nas duas versões. Isso prova que a suíte reproduz os
problemas e que o comportamento correto foi preservado.

O teste de fuso escolhe um fuso de sessão (Kiritimati ou Pago Pago) cujo "hoje" difere do de
São Paulo naquele instante. Ele confirma que pagamento de fatura e recebimento usam o dia de São Paulo
e que as duas ações continuam reversíveis no Histórico.

Não houve verificação visual em navegador neste patch. As mudanças de front são de lógica de datas
e de importação, cobertas por TypeScript, pela validação do helper e pela revisão do diff.

## Aplicação no banco pelo Lovable

As migrations são retrocompatíveis: podem ir ao banco antes do merge, e o front entra no ar depois do
merge e da publicação.

Prompt enviado ao Lovable (curto, sem gerar código):

> Aplique no banco, exatamente como estão, as migrations do PR (branch
> `claude/furushima-audit-completo-a40zdy`): `supabase/migrations/20261013120000_fix_recurrence_generation.sql`
> e `supabase/migrations/20261013120100_pin_financial_functions_timezone.sql`, registrando as versões
> 20261013120000 e 20261013120100. Não gere, altere ou crie arquivos de código nem migrations novas.
> Responda apenas OK ou o erro.

Situação: **pendente**. Atualizar esta seção com a confirmação e a conferência em produção.

## Rollback

1. Front: reverter os commits de `fix(app)`, `fix(import)` e `fix(server)` desta branch.
2. Fuso: `ALTER FUNCTION <assinatura> RESET timezone;` para as 16 funções listadas acima.
3. Recorrências: reaplicar `generate_recurring_transactions` e `run_financial_daily_maintenance` de
   `20260904190200_full_project_hardening.sql` e `generate_recurring_recharges` de
   `20260807162849_9bdcd0d1-f9c6-4c98-9d8a-3f9edb7fe243.sql`.
4. Dado: comando de reversão na seção "Ação de dados em produção".

## Observações auditadas e mantidas (sem correção neste patch)

- **Compra com fatura paga** não pode ser alterada nem excluída (trigger). Isso está correto para
  exclusão. A tela não edita transações hoje. Se a edição for criada, permitir mudar só
  descrição e categoria sem refazer as parcelas.
- **Dia de fechamento** conta para a fatura atual (`card_cycle_due`). Alguns bancos lançam compras do
  dia do fechamento na fatura seguinte. É regra de negócio: confirmar com o titular antes de mudar.
- **Faturas R$ 0** continuam no resumo do painel (`get_dashboard_snapshot`); 0 casos em produção.
- **Policy `viewer_invitations_participant_read`** usa `auth.uid()` sem subquery InitPlan. A tabela é
  mínima e não há impacto prático.
- **Importação CSV** sem coluna Conta continua criando lançamentos "a classificar" (aparecem como
  saldo sem conta na Carteira Global).
- **Lembrete de aporte** em Investimentos usa `localStorage` apenas para não repetir o aviso no mesmo
  dia. É UI, não automação de negócio.
- **Versões de migration em produção** diferem de alguns nomes de arquivo antigos (padrão do Lovable,
  ex.: `20260904190200` aplicada como `20260904233616/233905`). Sem impacto.
