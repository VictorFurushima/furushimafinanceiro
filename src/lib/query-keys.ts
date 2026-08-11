/**
 * Fábrica central de query keys.
 * Todas as agregações do Postgres ficam sob o prefixo ["finance", ...],
 * de modo que invalidar ["finance"] recalcula overview, séries, saldos, etc.
 */

export interface TransactionFilters {
  page?: number;
  pageSize?: number;
  type?: "all" | "income" | "expense";
  categoryId?: string;
  accountId?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  search?: string;
}

export const financeKeys = {
  // agregados (RPC)
  aggregates: ["finance"] as const,
  overview: ["finance", "overview"] as const,
  monthlySummary: (from: string, to: string) => ["finance", "monthly-summary", from, to] as const,
  spendingByCategory: (from: string, to: string) =>
    ["finance", "spending-by-category", from, to] as const,
  accountBalances: ["finance", "account-balances"] as const,
  monthlySeries: (months: number) => ["finance", "monthly-series", months] as const,
  statisticsExtras: (from: string, to: string) =>
    ["finance", "statistics-extras", from, to] as const,
  dashboardSnapshot: ["finance", "dashboard-snapshot"] as const,

  // listas
  transactions: ["transactions"] as const,
  transactionsList: (filters: TransactionFilters) => ["transactions", "list", filters] as const,
  transactionsRecent: (limit: number) => ["transactions", "recent", limit] as const,
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  budgets: (month: string) => ["budgets", month] as const,
  budgetsAll: ["budgets"] as const,
  recurring: ["recurring"] as const,
  goals: ["goals"] as const,
  categoryLimits: ["category_limits"] as const,
  recharges: ["recharges"] as const,
  creditCards: ["credit_cards"] as const,
  creditCardBills: ["credit_card_bills"] as const,
  investments: ["investments"] as const,
  investmentEvents: (id?: string) => ["investment_events", id ?? "all"] as const,
  notes: ["notes"] as const,
  shoppingItems: ["shopping_items"] as const,
  userSettings: ["user_settings"] as const,
  viewers: ["my_viewers"] as const,
};

export interface TaskFilters {
  status?: string;
  category?: string;
  priority?: string;
  limit?: number;
}

/** Keys do hub pessoal (agenda, rotinas, tarefas, alertas). */
export const hubKeys = {
  events: ["calendar_events"] as const,
  eventsRange: (from: string, to: string) => ["calendar_events", "range", from, to] as const,
  routines: ["routines"] as const,
  routineOccurrences: ["routine_occurrences"] as const,
  routineOccurrencesRange: (from: string, to: string) =>
    ["routine_occurrences", "range", from, to] as const,
  tasks: ["tasks"] as const,
  tasksList: (filters: TaskFilters) => ["tasks", "list", filters] as const,
  alerts: ["alerts"] as const,
  alertsUpcoming: (limit: number) => ["alerts", "upcoming", limit] as const,
  calendarIntegration: ["calendar_integration"] as const,
};

export type FinanceDomain =
  | "transactions"
  | "accounts"
  | "categories"
  | "budgets"
  | "recurring"
  | "goals"
  | "categoryLimits"
  | "recharges"
  | "cards"
  | "investments"
  | "notes"
  | "shopping"
  | "settings"
  | "viewers"
  | "events"
  | "routines"
  | "tasks"
  | "alerts"
  | "calendarIntegration";

/** Famílias de query afetadas por cada domínio de mutação. */
const DOMAIN_KEYS: Record<FinanceDomain, readonly (readonly unknown[])[]> = {
  transactions: [financeKeys.transactions, financeKeys.aggregates, financeKeys.budgetsAll],
  accounts: [financeKeys.accounts, financeKeys.aggregates],
  categories: [financeKeys.categories, financeKeys.aggregates],
  budgets: [financeKeys.budgetsAll],
  recurring: [financeKeys.recurring, financeKeys.aggregates],
  goals: [financeKeys.goals, financeKeys.aggregates],
  categoryLimits: [financeKeys.categoryLimits],
  recharges: [financeKeys.recharges, financeKeys.aggregates],
  cards: [financeKeys.creditCards, financeKeys.creditCardBills, financeKeys.aggregates],
  investments: [
    financeKeys.investments,
    ["investment_events"] as const,
    financeKeys.transactions,
    financeKeys.aggregates,
  ],
  notes: [financeKeys.notes],
  events: [hubKeys.events, hubKeys.alerts],
  routines: [hubKeys.routines, hubKeys.routineOccurrences, hubKeys.alerts],
  tasks: [hubKeys.tasks],
  alerts: [hubKeys.alerts],
  calendarIntegration: [hubKeys.calendarIntegration],

  shopping: [financeKeys.shoppingItems, financeKeys.transactions, financeKeys.aggregates],
  settings: [financeKeys.userSettings, financeKeys.aggregates],
  viewers: [financeKeys.viewers],
};

interface QueryInvalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
}

/** Invalida somente as famílias relacionadas aos domínios informados. */
export function invalidateFinance(qc: QueryInvalidator, ...domains: FinanceDomain[]) {
  const seen = new Set<string>();
  for (const domain of domains) {
    for (const key of DOMAIN_KEYS[domain]) {
      const id = JSON.stringify(key);
      if (seen.has(id)) continue;
      seen.add(id);
      qc.invalidateQueries({ queryKey: key });
    }
  }
}
