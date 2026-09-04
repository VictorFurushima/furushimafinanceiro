# PATCH 2026-09-04 — Reestruturação financeira e remoção do hub pessoal

## Objetivo

Concentrar o produto no controle financeiro: remover as áreas de Hoje, Agenda,
Rotinas, Tarefas, Anotações e a integração com o Google Calendar, e evoluir o
modelo de transações para diferenciar receita, despesa, compra no cartão,
transferência entre contas e pagamento de fatura.

## Banco de dados (migration incremental)

- `DROP` de `calendar_events`, `calendar_integrations`, `routines`,
  `routine_occurrences`, `tasks`, `notes`, `alerts` (todas vazias na auditoria),
  junto de policies, índices e triggers próprios.
- `DROP` de `materialize_routine_events(integer)` e
  `complete_routine_occurrence(uuid, date, text)`.
- `transactions`: novo CHECK de `type` (`income | expense | transfer`), novas
  colunas `credit_card_id`, `destination_account_id`, `bill_id`, CHECK de
  transferência (origem e destino obrigatórios e distintos) e índices parciais
  para as três colunas.
- Trigger `trg_apply_card_purchase`: despesa com `credit_card_id` consome o
  limite do cartão e alimenta a fatura do ciclo, sem tocar no saldo da conta.
- `pay_credit_card_bill(p_bill_id, p_account_id)`: quita a fatura, libera o
  limite e, quando há conta pagadora, grava a saída com `flow='bill_payment'`
  (não conta de novo como despesa real do mês).
- `get_account_balances` e `get_financial_overview` reescritas: compra no cartão
  não debita conta e transferências se anulam no patrimônio.

## Frontend

- Rotas, hooks, componentes e query keys do hub pessoal removidos
  (`use-schedule-data`, `schedule-constants`, `calendar-sync.functions`,
  diálogos de evento/tarefa/rotina/nota, `hubKeys`, domínios de invalidação).
- Navegação (desktop e mobile) sem os itens descartados.
- `transaction-dialog`: três abas (Despesa, Receita, Transferência), seleção de
  cartão quando a forma de pagamento é crédito e conta de destino na
  transferência, com validação por Zod.
- `transactions`: transferência não entra no total do período e tem ícone,
  sinal e rótulo próprios (inclusive no CSV).
- `cards`: botão "Agendar" removido; pagamento de fatura passa a escolher a
  conta pagadora.
- `accounts`: tipos oferecidos passam a ser carteira física, banco digital,
  banco tradicional, poupança e outro, com rótulos legados preservados.
- Embeds de `accounts` em `transactions` agora usam a dica
  `accounts!transactions_account_id_fkey` (duas FKs para a mesma tabela).

## Validação

- `tsgo --noEmit` limpo.
- ESLint limpo nos arquivos alterados.
- Preview responde 200 em `/dashboard` sem erro de SSR.

## CONTEXTO PARA PRÓXIMA IA

- Não recriar agenda, rotinas, tarefas, anotações ou integração de calendário.
- Compra no cartão nunca debita conta: o efeito é limite + fatura, feito pelo
  trigger no banco, não no frontend.
- Pagamento de fatura usa `flow='bill_payment'`; não somar esse fluxo como
  despesa real do mês nas agregações.
- Transferência não altera patrimônio total; só move saldo entre contas.
- Ler antes de mexer: `src/components/transaction-dialog.tsx`,
  `src/routes/_app/{cards,accounts,transactions}.tsx`,
  `src/hooks/use-finance-data.ts`, `src/lib/query-keys.ts`.
