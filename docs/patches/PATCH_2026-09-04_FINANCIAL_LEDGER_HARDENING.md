# PATCH 2026-09-04 — Integridade do ledger financeiro

## Objetivo e estado validado

A revisão comparou o checkpoint da Issue #1, o Lovable, `main` no GitHub e o
banco. O commit Lovable `d4e5128b3a3196c38a4bf8a2030861340fd18af3`
implementou a primeira etapa e foi confirmado como `main` nos dois sistemas. A
migration `20260904163028` está aplicada no banco e seu SQL corresponde ao
arquivo do GitHub, ignorando comentários, espaços e separadores.

As tabelas removidas (`alerts`, `calendar_events`, `calendar_integrations`,
`notes`, `routine_occurrences`, `routines`, `tasks`) não existem mais. As 18
tabelas restantes mantêm RLS; contas, transações, cartões e faturas preservam as
policies de leitura do espaço e escrita do administrador.

## Problemas encontrados depois da primeira etapa

- A automação do cartão funcionava somente em `INSERT`; editar/excluir uma
  compra deixava limite e fatura incorretos.
- A compra entrava na fatura pelo mês da compra, sem usar o dia de fechamento.
- Parcelas, centavos, dezembro e meses curtos não eram tratados.
- O Planejador implementava um segundo cálculo de cartão e podia divergir.
- Era possível quitar fatura sem conta pagadora, editar valores de uma fatura
  paga e tentar remover entidades que sustentam o histórico.
- O saldo histórico das Estatísticas tratava transferência e compra no cartão
  como saída de caixa.
- Filtros e a Visão Geral ainda exibiam transferência como despesa.

## Banco e migrations incrementais

### `20260904190000_harden_financial_ledger.sql`

- Adiciona `transactions.installment_count` (1–120) e valida valores positivos.
- Adiciona `credit_card_bills.manual_amount` para separar saldo anterior de
  parcelas geradas pelo sistema.
- Cria `credit_card_bill_items`, ledger normalizado de parcelas, com RLS de
  leitura para o espaço financeiro e escrita reservada aos triggers.
- Calcula ciclo pelo fechamento, vencimento após fechamento, meses curtos e
  virada do ano. Distribui centavos sem perder ou criar valor.
- Recalcula faturas e `used_limit` a partir do ledger. Formulários ou chamadas
  diretas não conseguem criar uma segunda fonte para o limite usado.
- Atualização/exclusão de compra refaz ou remove as parcelas. Compra de fatura
  já paga exige estorno anterior.
- `pay_credit_card_bill` exige administrador e conta pagadora, trava cartão e
  fatura, registra um único `bill_payment` e permanece idempotente.
- Excluir o lançamento de pagamento reabre a fatura, restaura o limite devido
  e devolve o valor ao saldo da conta. O histórico referenciado usa FKs
  `RESTRICT`.
- Valida que contas, destino, categoria, cartão e fatura pertencem ao mesmo
  titular. Viewer continua somente leitura.
- `complete_shopping_item` passa a usar o mesmo ledger de Transações; a lógica
  duplicada do Planejador foi removida. Entrada de compra parcelada é rejeitada
  com orientação explícita, pois o modelo não define uma ligação contábil entre
  a entrada e o financiamento.
- Inclui guarda de implantação: como a auditoria confirmou 0 cartões, faturas e
  transações, a migration prossegue agora; em ambiente divergente, aborta e pede
  reconciliação em vez de converter valores por suposição.

### `20260904190100_fix_financial_cash_series.sql`

- Corrige `get_statistics_extras.opening_balance` para excluir transferências e
  compras no cartão.
- Adiciona `cash_series`, fluxo de caixa mensal que inclui pagamento de fatura
  quando o dinheiro realmente sai da conta. As séries de receita/despesa da
  Visão Geral permanecem pelo regime da compra e não foram redesenhadas.

## Frontend e backend

- Cadastro de compra aceita 1–120 parcelas e não envia conta para compra no
  cartão.
- Cartões exigem conta pagadora e impedem clique sem conta ou valor.
- Limite usado fica somente leitura; fatura manual foi renomeada como saldo
  anterior e não sobrescreve um ciclo existente.
- Transações incluem filtro de transferência, ignoram `bill_payment` no saldo
  da página e confirmam a reversão antes da exclusão.
- A lista recente da Visão Geral ganhou apresentação neutra para transferência;
  nenhum card, gráfico ou fluxo da tela foi removido.
- MCP `list_transactions`, tipos Supabase e invalidação de caches foram
  atualizados para os novos campos e fluxos.
- A navegação móvel agora aponta para Visão Geral, Transações, Contas e Cartões;
  referências residuais às rotas removidas foram eliminadas.

## Validação

- `tsc --noEmit`: aprovado.
- ESLint dos arquivos alterados: aprovado.
- 14 testes integrados em PostgreSQL isolado: transferência; compra; edição;
  exclusão; ciclo; ano bissexto; parcelas e centavos; pagamento idempotente;
  estorno; ownership; FKs; fatura manual; Planejador; Estatísticas; viewer; cron.
- O build local atingiu uma incompatibilidade preexistente do plugin Lovable no
  Windows ao comparar caminhos com barras diferentes. O build deve ser repetido
  no ambiente Linux do Lovable antes da aplicação no banco.

## Riscos e rollback

A migration endurece FKs de `SET NULL` para `RESTRICT`; exclusões passam a exigir
a remoção consciente dos lançamentos relacionados. A trava por cartão evita
duplo pagamento e inconsistência concorrente. Operações concorrentes que
disputarem entidades em ordem diferente podem receber deadlock do PostgreSQL e
ser revertidas atomicamente; o cliente pode repetir a operação.

Para rollback, não editar migrations aplicadas. Criar uma migration incremental
que exporte `credit_card_bill_items`, remova os triggers/funções novos, restaure
as FKs anteriores e só depois remova tabela/colunas. Reverter código antes do DB
deixaria o formulário antigo sem suporte a parcelas e não é recomendado.

## Pendências fora do escopo contábil definido

- Publicar a versão do Lovable continua uma ação de release separada.
- Se for desejado modelar entrada de compra parcelada como operação única, é
  necessário definir se a entrada é despesa imediata em conta e como ela se
  relaciona ao financiamento. Nenhum comportamento foi inventado nesta entrega.
