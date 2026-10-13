# Patch de 13/10/2026: auditoria completa (banco, back e front)

Data: 13/10/2026. Base: 97b3decc8dc444e647be4ec1fe2400102d74b392 (mesmo commit do Lovable).
Branch: `claude/furushima-audit-completo-a40zdy`.
Projeto: VictorFurushima/furushimafinanceiro, Lovable ec051308-bc31-4b3a-854d-14e500a89183.

## Resumo

Revisão integral do projeto, com o banco conferido **contra produção** pelo conector Lovable. O acesso
foi somente leitura, exceto as escritas autorizadas pelo titular: o cancelamento da cópia duplicada, a
aplicação das 2 migrations da auditoria e, depois dos testes ponta a ponta, a da migration de
convites, todas descritas abaixo. Foram encontrados e corrigidos 4 problemas
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

## Banco (2 migrations da auditoria, nenhuma migration antiga editada)

A terceira, de convites, está na seção de testes ponta a ponta.

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

## Testes ponta a ponta do site (pedido do titular em 13/10, tarde)

O titular suspeitou que o import por print tinha quebrado e que outras telas tinham quebrado em cadeia.

**Produção (somente leitura, mais uma simulação desfeita):**

- Leitura dos prints: 11 prints enviados entre 14:17 e 14:22, todos lidos ("completed"), depois das
  migrations.
- Salvamentos: 9 compras salvas entre 14:18 e 14:20, com fatura, limite e histórico atualizados.
- Pendentes: os 50 itens pendentes passaram por `save_ocr_review` como o titular (papel
  `authenticated`), numa transação forçada a desfazer. Resultado: 34 salvariam, 15 voltariam como
  "possível duplicação" (comparação esperada quando a mesma compra aparece em dois prints) e 1 está
  sem data. Contagens conferidas depois: nada foi gravado.

**Navegador:** a rede desta sessão bloqueia `*.lovable.app` e `*.supabase.co`, então o site publicado
não pôde ser aberto daqui. Foi criado um teste ponta a ponta local e reutilizável (`npm run test:e2e`):

- `tests/e2e/supabase-emulator.mjs`: emula auth, PostgREST (select com recursos embutidos, filtros,
  contagem, insert/upsert/update/delete), RPC e storage sobre PGlite com todas as migrations. Cada
  requisição roda como `authenticated` com o `sub` do JWT, com RLS, grants e triggers reais.
- `tests/e2e/seed.mjs`: espaço sintético parecido com o real (cartão com fechamento 20 e vencimento
  30, parcelas, fatura paga, assinaturas, salário recorrente, meta, investimento e um print com 5
  itens pendentes).
- `tests/e2e/site.e2e.mjs` e `flows.mjs`: o app real em `vite dev` com Chromium. São 19 telas e 22
  fluxos: print (salvar, duplicata, avisos, sem data, lote, novo envio), transações, parcelas,
  pagamento de fatura, assinaturas, recargas, metas, linha do tempo, CSV, histórico, investimentos,
  configurações, convite e espectador. Cada fluxo confere a tela e o banco.

| Código testado                      | Resultado                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Este PR                             | **42/42**, duas rodadas seguidas, sem erros de console ou de API                                                                                                              |
| `main` (código no ar) + banco atual | 38/42. Falham as assinaturas ("em hoje"), a linha do tempo de hoje e o CSV com transferência, além do histórico, que dependia do CSV. São exatamente bugs que este PR corrige |

Conclusão: o import por print **não está quebrado**, nem no código no ar nem no banco. Não houve
quebra em cadeia nas demais telas. A IA de leitura não foi emulada; em produção ela leu os 11 prints
do dia.

**Bugs novos encontrados pelos testes e corrigidos:**

1. **Convites de espectador (produção):** `list_my_viewer_invitations()` era SECURITY INVOKER e lia
   `auth.users`, que o papel `authenticated` não pode consultar. Toda abertura de Configurações
   recebia 403 ("permission denied for table users") e o convidado nunca via o convite. A migration
   `20261013130000_fix_viewer_invitations_listing.sql` segue o padrão de `list_my_viewers`: função
   privada SECURITY DEFINER, filtrada por `auth.uid()`, mais um wrapper público. O teste
   `npm run test:viewers` (5 verificações) reproduz o erro no schema anterior.
2. **CSV, introduzido por este próprio patch:** escolher o arquivo antes de contas, categorias e
   cartões carregarem marcava todas as linhas como "Conta não encontrada". A análise agora é
   recalculada quando os cadastros chegam, e importar fica bloqueado até lá.

## Aplicação no banco

As migrations são retrocompatíveis: foram ao banco antes do merge. O front entra no ar depois do merge
do PR e da publicação no Lovable.

### Tentativa pelo Lovable (recusada, nada aplicado)

Primeiro foi pedido ao agente do Lovable que aplicasse as 2 migrations com os nomes exatos do PR, sem
gerar código. Ele respondeu: "a ferramenta disponível gera migrations em caminhos próprios e não permite
especificar os dois caminhos exatos exigidos; nenhuma migration foi aplicada". Custo: 0,9 crédito. O
banco ficou intacto. Na mesma rodada, a plataforma atualizou `@lovable.dev/vite-tanstack-config` para
2.25.3 na `main`; essa atualização já foi incorporada ao PR por merge.

### Aplicação pelo conector (13/10/2026, autorizada pelo titular)

Para manter os nomes do PR e não gastar créditos, o titular autorizou aplicar pelo conector do banco.
O bloco único `BEGIN … COMMIT` contém o conteúdo integral dos 2 arquivos e os 2 registros em
`supabase_migrations.schema_migrations`, no mesmo formato usado pelo Lovable: versão, nome e conteúdo
do arquivo. Antes, o bloco foi ensaiado em PGlite sobre o schema anterior.

Conferência em produção (somente leitura), idêntica ao ensaio local:

| Item                                                                                                          | Resultado                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| md5 de `run_financial_daily_maintenance` / `generate_recurring_transactions` / `generate_recurring_recharges` | `d19be89d…` / `280a711e…` / `5f162880…` (iguais ao ensaio)                                                                                                                                   |
| Funções com `TimeZone=America/Sao_Paulo` / `TimeZone=UTC`                                                     | 13 / 3                                                                                                                                                                                       |
| `schema_migrations`                                                                                           | `20261013120000 fix_recurrence_generation` e `20261013120100 pin_financial_functions_timezone`; md5 do conteúdo igual aos arquivos do PR (`a6c74af9…` / `3f36e848…`); 47 migrations no total |
| Permissões                                                                                                    | inalteradas (cron só `postgres`; gerador de recargas sem `authenticated`; gerador de despesas com `authenticated`)                                                                           |
| Cron `financial-daily-maintenance`                                                                            | ativo                                                                                                                                                                                        |
| Cópia do Salário de 20/10                                                                                     | `cancelada`; modelo `confirmada` intacto                                                                                                                                                     |
| Receita fixa prevista de outubro                                                                              | R$ 2.750 em 1 recarga (antes R$ 5.500 em 2)                                                                                                                                                  |

### Convites de espectador (13/10/2026, autorizada pelo titular)

A terceira migration, `20261013130000_fix_viewer_invitations_listing.sql`, foi criada depois dos
testes ponta a ponta e aplicada pelo mesmo caminho: ensaio em PGlite e depois um bloco único
`BEGIN … COMMIT` com o arquivo integral e o registro em `schema_migrations`. Nenhum dado foi alterado.

Conferência em produção (somente leitura), idêntica ao ensaio local:

| Item                                                   | Resultado                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Estado anterior                                        | só `public.list_my_viewer_invitations()`, SECURITY INVOKER; 47 migrations                                                     |
| md5 da função privada / do wrapper público             | `e1720a60…` / `7dace66c…` (iguais ao ensaio)                                                                                  |
| SECURITY DEFINER                                       | privada sim (`search_path=public, pg_temp`); wrapper público não                                                              |
| Permissões das 2 funções                               | `postgres`, `authenticated` e `service_role`; `anon` sem EXECUTE                                                              |
| `schema_migrations`                                    | `20261013130000 fix_viewer_invitations_listing`; md5 do conteúdo igual ao arquivo do PR (`20c4f507…`); 48 migrations no total |
| Chamada como titular (papel `authenticated`, desfeita) | executa sem "permission denied"; 0 convites pendentes                                                                         |

A tabela `viewer_invitations` está vazia em produção: nenhum convite ficou perdido por causa do erro.
Com o banco corrigido, a tela Configurações deixa de receber 403 já no código que está no ar.

Próximo passo: fazer o merge do PR e publicar no Lovable (botão Publish). Não é preciso enviar
prompt nem regenerar tipos, porque nenhuma assinatura mudou.

## Rollback

1. Front: reverter os commits de `fix(app)`, `fix(import)` e `fix(server)` desta branch.
2. Fuso: `ALTER FUNCTION <assinatura> RESET timezone;` para as 16 funções listadas acima.
3. Recorrências: reaplicar `generate_recurring_transactions` e `run_financial_daily_maintenance` de
   `20260904190200_full_project_hardening.sql` e `generate_recurring_recharges` de
   `20260807162849_9bdcd0d1-f9c6-4c98-9d8a-3f9edb7fe243.sql`.
4. Dado: comando de reversão na seção "Ação de dados em produção".
5. Convites: recriar `public.list_my_viewer_invitations` como em `20260904190200` e remover
   `private.list_my_viewer_invitations`.

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
