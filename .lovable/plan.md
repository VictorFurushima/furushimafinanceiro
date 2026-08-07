# Módulo: Recargas de Saldo e Previsão de Entrada

## 1. Banco de dados (migration)

Criar 3 novas tabelas com RLS (`auth.uid() = user_id`):

**`balance_recharges`** — entradas previstas (salário, freelance, reembolso, fatura, liberação de limite, etc.)
- `name`, `recharge_type` (enum text), `expected_amount`, `expected_date`, `account_id`, `payment_method`, `status` (prevista/confirmada/recebida/atrasada/cancelada), `notes`, `converted_to_income` (bool), `is_recurring` (bool), `recurring_day` (int), `card_id` (opcional, para fatura/limite)

**`credit_cards`**
- `name`, `bank`, `total_limit`, `used_limit`, `closing_day`, `due_day`, `status`, `color`
- `available_limit` calculado em runtime (`total - used`)

**`credit_card_bills`**
- `card_id`, `month`, `year`, `amount`, `due_date`, `payment_date`, `status` (aberta/paga/atrasada)
- unique `(card_id, month, year)`

**Funções SQL (SECURITY DEFINER, auth.uid()):**
- `generate_recurring_recharges()` — cria recarga prevista do mês para cada recarga recorrente, sem duplicar
- `mark_overdue_recharges()` — muda status para "atrasada" se data passou e não foi recebida
- `confirm_recharge_as_income(recharge_id)` — marca como recebida + cria transaction tipo income (exceto fatura/limite)
- `pay_credit_card_bill(bill_id)` — marca fatura como paga, diminui `used_limit` do cartão

## 2. Hooks (`use-finance-data.ts`)

Adicionar: `useRecharges`, `useCreditCards`, `useCreditCardBills`, `useUpcomingEvents` (recargas + faturas combinadas ordenadas por data).

## 3. Páginas novas

- **`/recharges`** — lista de recargas com filtros por status/tipo, dialog para CRUD, botão "marcar como recebida"
- **`/cards`** — substitui/complementa `/accounts` com foco em cartões: nome, banco, barra de limite usado/disponível, próxima fatura, dialog de pagamento
- **`/timeline`** — linha do tempo cronológica dos próximos 60 dias (recargas + faturas + transações recorrentes) com cores por tipo

## 4. Componentes novos

- `RechargeDialog` — formulário completo (tipo, valor, data, conta, status, recorrente)
- `CreditCardDialog` — formulário de cartão
- `PayBillDialog` — confirma pagamento de fatura
- `TimelineList` — lista visual com ícones e cores
- `NextRechargeCard` — card destacado para o dashboard
- `CardLimitBar` — barra de progresso de limite

## 5. Dashboard

Adicionar:
- Card "Próxima Recarga" (nome, valor, dias restantes)
- Card "Saldo Previsto fim do mês" (saldo real + recargas previstas/confirmadas - despesas previstas)
- Card "Total previsto no mês" e "Total confirmado"
- Seção "Faturas próximas" (badges com dias até vencimento)
- Seção "Limite disponível por cartão"
- Alertas no topo: recargas atrasadas, faturas a vencer em 5d, limite < 20%, saldo previsto negativo

## 6. Sidebar / Navegação

Adicionar itens: **Recargas** (`Inbox` icon), **Cartões** (`CreditCard` icon), **Linha do Tempo** (`CalendarClock` icon). Atualizar MobileNav.

## 7. Automação

Em `_app.tsx`, junto da chamada de `generate_recurring_transactions`, chamar também:
- `generate_recurring_recharges()`
- `mark_overdue_recharges()`

Uma vez por dia, controlado por `localStorage`.

## 8. Tipos / constantes

`finance-constants.ts`: adicionar `RECHARGE_TYPES`, `RECHARGE_STATUS`, `BILL_STATUS` com labels em PT-BR e cores.

## 9. Notificações

Componente `FinancialAlerts` no topo do dashboard mostrando avisos críticos (recargas atrasadas, faturas próximas, limite baixo). Usa `sonner` para toasts pontuais.

## Detalhes técnicos

- RLS: todas as tabelas usam policy `auth.uid() = user_id`
- Cores semânticas via tokens existentes (`success` para receitas/recargas, `destructive` para atrasos/faturas, `primary` teal para destaque)
- Mantém paleta Furushima (dark teal/cyan) e tipografia Outfit/Figtree
- `converted_to_income` previne dupla contabilização
- `available_limit` é derivado (não armazenado) para evitar inconsistência

Após sua aprovação, executo a migration e implemento todos os arquivos.
