## Visão geral

Vou expandir o **Furushima Financeiro** existente (que já tem dashboard, transações, contas, orçamentos e auth) adicionando os módulos pedidos: assinaturas recorrentes com lançamento automático, metas, estatísticas avançadas, importação CSV, filtros globais e configurações. O design dark mode atual (paleta Furushima teal/cyan) será mantido.

## O que já existe (será reaproveitado)

- Auth completo + RLS por usuário
- Tabelas: `transactions`, `categories`, `accounts`, `budgets`, `profiles`
- Páginas: Dashboard, Transações, Orçamentos, Contas
- Sidebar + navegação mobile
- Hooks `use-finance-data`, formatação BRL

## Mudanças no banco de dados

**Novas colunas em `transactions`:**
- `subcategory` (text, nullable)
- `payment_method` (text, nullable) — pix, dinheiro, debito, credito, boleto, transferencia
- `notes` (text, nullable)
- `recurring_id` (uuid, nullable) — referência à assinatura que gerou

**Nova tabela `recurring_expenses`:**
- name, amount, category_id, payment_method, billing_day (int 1-31), frequency (mensal/semanal/anual), start_date, end_date, status (active/paused/cancelled), last_generated_at

**Nova tabela `goals`:**
- name, target_amount, current_amount, deadline, category_id, color

**Nova tabela `category_limits`:**
- category_id, monthly_limit

Todas com RLS por `user_id`.

**Função SQL `generate_recurring_transactions()`** + cron diário (pg_cron) que gera as despesas das assinaturas ativas no dia correto, sem duplicar (idempotente via `recurring_id` + mês).

## Novas páginas

```
/dashboard          ← expandir KPIs (economia, % gasto, próximas assinaturas, comparação mês anterior)
/transactions       ← adicionar filtros, subcategoria, forma de pagamento, exportar CSV
/income             ← (nova) registro de receitas dedicado
/recurring          ← (nova) assinaturas e despesas recorrentes
/goals              ← (nova) metas com barras de progresso
/statistics         ← (nova) análises: gasto/mês, média diária/semanal, top 10, dias com mais gasto, formas de pagamento
/budgets            ← já existe
/accounts           ← já existe
/import             ← (nova) importação CSV com validação
/settings           ← (nova) categorias, limites por categoria, notificações
```

## Componentes novos

- `RecurringDialog` — criar/editar assinatura
- `GoalDialog` — criar/editar meta
- `IncomeDialog` — receita rápida
- `CsvImportDialog` — upload + preview + validação
- `TransactionFilters` — filtros globais reutilizáveis
- `StatCard` extraído para `components/stat-card.tsx`
- `ProgressBar` para metas/orçamentos
- Atualizar `TransactionDialog` com subcategoria, forma de pagamento, observação

## Filtros

Hook `use-transaction-filters` com: mês, ano, categoria, forma pagamento, tipo, valor min/max, período customizado. Usado em Transações e Estatísticas.

## CSV

- Export: botão em Transações → gera CSV no navegador
- Import: parse via PapaParse, validação Zod, preview de erros antes de salvar em lote

## Automação de recorrentes

Migration cria função PL/pgSQL `generate_recurring_for_user(user_id)` e cron diário (pg_cron + pg_net chamando endpoint `/api/public/hooks/run-recurring`) — ou mais simples: trigger executado on-demand quando o usuário abre o dashboard (chamando uma server function). Vou usar a abordagem **client-triggered server function** chamada no login/dashboard load para evitar setup de cron e secrets — é idempotente e suficiente.

## Design

- Mantém paleta Furushima atual (teal/cyan dark)
- Verde para receitas, vermelho para despesas, accent teal para destaques
- Cards arredondados, gráficos Recharts (já em uso)
- Sidebar atualizada com novos itens (ícones lucide: Repeat, Target, BarChart3, Upload, Settings)

## Ordem de execução

1. Migration: novas colunas/tabelas + RLS + função de recorrentes
2. Atualizar `use-finance-data` com novos hooks (recurring, goals, income filter, limits)
3. Server function `generate-recurring.functions.ts` chamada no app load
4. Atualizar sidebar com novas rotas
5. Criar páginas: recurring, goals, statistics, income, import, settings
6. Atualizar dashboard com KPIs novos
7. Atualizar TransactionDialog + Transactions com filtros, CSV export, novos campos
8. Instalar `papaparse` para import

Pronto para começar?