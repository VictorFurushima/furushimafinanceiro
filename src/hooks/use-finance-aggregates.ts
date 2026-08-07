import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys } from "@/lib/query-keys";

const num = (v: unknown) => Number(v ?? 0);

export interface FinancialOverviewRow {
  saldo_disponivel: number;
  total_investido: number;
  valor_atual_investimentos: number;
  rendimento_total: number;
  patrimonio_total: number;
  gastos_reais_mes: number;
  receitas_reais_mes: number;
  aportes_mes: number;
  resgates_mes: number;
  gastos_fixos: number;
  contas_pendentes: number;
  faturas_abertas: number;
  faturas_previstas: number;
  receitas_previstas_seguras: number;
  min_reserve: number;
  max_free_balance_pct: number;
  max_income_installment_pct: number;
  aportes_programados: number;
}

export const EMPTY_OVERVIEW: FinancialOverviewRow = {
  saldo_disponivel: 0,
  total_investido: 0,
  valor_atual_investimentos: 0,
  rendimento_total: 0,
  patrimonio_total: 0,
  gastos_reais_mes: 0,
  receitas_reais_mes: 0,
  aportes_mes: 0,
  resgates_mes: 0,
  gastos_fixos: 0,
  contas_pendentes: 0,
  faturas_abertas: 0,
  faturas_previstas: 0,
  receitas_previstas_seguras: 0,
  min_reserve: 0,
  max_free_balance_pct: 30,
  max_income_installment_pct: 20,
  aportes_programados: 0,
};

export const useFinancialOverview = () =>
  useQuery({
    queryKey: financeKeys.overview,
    queryFn: async (): Promise<FinancialOverviewRow> => {
      const { data, error } = await supabase.rpc("get_financial_overview");
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      const out = { ...EMPTY_OVERVIEW };
      (Object.keys(EMPTY_OVERVIEW) as (keyof FinancialOverviewRow)[]).forEach((k) => {
        if (raw[k] !== undefined && raw[k] !== null) out[k] = num(raw[k]);
      });
      return out;
    },
  });

export interface MonthlySummary {
  receitas: number;
  despesas: number;
  aportes: number;
  resgates: number;
  saldo_liquido: number;
}

export const useMonthlySummary = (from: string, to: string) =>
  useQuery({
    queryKey: financeKeys.monthlySummary(from, to),
    queryFn: async (): Promise<MonthlySummary> => {
      const { data, error } = await supabase.rpc("get_monthly_financial_summary", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      return {
        receitas: num(row?.receitas),
        despesas: num(row?.despesas),
        aportes: num(row?.aportes),
        resgates: num(row?.resgates),
        saldo_liquido: num(row?.saldo_liquido),
      };
    },
  });

export interface CategorySpending {
  category_id: string | null;
  name: string;
  color: string;
  icon: string;
  total: number;
}

export const useSpendingByCategory = (from: string, to: string) =>
  useQuery({
    queryKey: financeKeys.spendingByCategory(from, to),
    queryFn: async (): Promise<CategorySpending[]> => {
      const { data, error } = await supabase.rpc("get_spending_by_category", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        category_id: r.category_id,
        name: r.name,
        color: r.color,
        icon: r.icon,
        total: num(r.total),
      }));
    },
  });

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  color: string;
  initial_balance: number;
  balance: number;
}

export const useAccountBalances = () =>
  useQuery({
    queryKey: financeKeys.accountBalances,
    queryFn: async (): Promise<AccountBalance[]> => {
      const { data, error } = await supabase.rpc("get_account_balances");
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        color: a.color,
        initial_balance: num(a.initial_balance),
        balance: num(a.balance),
      }));
    },
  });

export interface MonthlySeriesPoint {
  month: string;
  receitas: number;
  despesas: number;
  aportes: number;
  resgates: number;
}

export const useMonthlySeries = (months: number) =>
  useQuery({
    queryKey: financeKeys.monthlySeries(months),
    queryFn: async (): Promise<MonthlySeriesPoint[]> => {
      const { data, error } = await supabase.rpc("get_monthly_series", { p_months: months });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        month: r.month,
        receitas: num(r.receitas),
        despesas: num(r.despesas),
        aportes: num(r.aportes),
        resgates: num(r.resgates),
      }));
    },
  });

export interface StatisticsExtras {
  day_of_week: { dow: number; total: number }[];
  payment_breakdown: { method: string; total: number }[];
  top_expenses: {
    id: string;
    description: string | null;
    category_name: string | null;
    amount: number;
  }[];
  opening_balance: number;
}

export const useStatisticsExtras = (from: string, to: string, top = 10) =>
  useQuery({
    queryKey: financeKeys.statisticsExtras(from, to),
    queryFn: async (): Promise<StatisticsExtras> => {
      const { data, error } = await supabase.rpc("get_statistics_extras", {
        p_from: from,
        p_to: to,
        p_top: top,
      });
      if (error) throw error;
      const raw = (data ?? {}) as Partial<StatisticsExtras>;
      return {
        day_of_week: (raw.day_of_week ?? []).map((d) => ({ dow: d.dow, total: num(d.total) })),
        payment_breakdown: (raw.payment_breakdown ?? []).map((p) => ({
          method: p.method,
          total: num(p.total),
        })),
        top_expenses: (raw.top_expenses ?? []).map((t) => ({ ...t, amount: num(t.amount) })),
        opening_balance: num(raw.opening_balance),
      };
    },
  });

export interface DashboardSnapshot {
  recharges_previsto_mes: number;
  recharges_confirmado_mes: number;
  recharges_restante_mes: number;
  next_recharge: {
    name: string;
    expected_amount: number;
    expected_date: string;
    days: number;
  } | null;
  recharges_overdue_count: number;
  recharges_upcoming_count: number;
  cards: { id: string; name: string; total_limit: number; used_limit: number }[];
  cards_count: number;
  cards_low_limit_count: number;
  upcoming_bills: {
    id: string;
    card_name: string | null;
    amount: number;
    due_date: string;
    days: number;
  }[];
  upcoming_bills_count: number;
  upcoming_subscriptions: { id: string; name: string; amount: number; days: number }[];
}

export const EMPTY_SNAPSHOT: DashboardSnapshot = {
  recharges_previsto_mes: 0,
  recharges_confirmado_mes: 0,
  recharges_restante_mes: 0,
  next_recharge: null,
  recharges_overdue_count: 0,
  recharges_upcoming_count: 0,
  cards: [],
  cards_count: 0,
  cards_low_limit_count: 0,
  upcoming_bills: [],
  upcoming_bills_count: 0,
  upcoming_subscriptions: [],
};

export const useDashboardSnapshot = () =>
  useQuery({
    queryKey: financeKeys.dashboardSnapshot,
    queryFn: async (): Promise<DashboardSnapshot> => {
      const { data, error } = await supabase.rpc("get_dashboard_snapshot");
      if (error) throw error;
      const raw = (data ?? {}) as Partial<DashboardSnapshot>;
      const nr = raw.next_recharge;
      return {
        recharges_previsto_mes: num(raw.recharges_previsto_mes),
        recharges_confirmado_mes: num(raw.recharges_confirmado_mes),
        recharges_restante_mes: num(raw.recharges_restante_mes),
        next_recharge: nr
          ? {
              name: nr.name,
              expected_amount: num(nr.expected_amount),
              expected_date: nr.expected_date,
              days: num(nr.days),
            }
          : null,
        recharges_overdue_count: num(raw.recharges_overdue_count),
        recharges_upcoming_count: num(raw.recharges_upcoming_count),
        cards: (raw.cards ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          total_limit: num(c.total_limit),
          used_limit: num(c.used_limit),
        })),
        cards_count: num(raw.cards_count),
        cards_low_limit_count: num(raw.cards_low_limit_count),
        upcoming_bills: (raw.upcoming_bills ?? []).map((b) => ({
          id: b.id,
          card_name: b.card_name,
          amount: num(b.amount),
          due_date: b.due_date,
          days: num(b.days),
        })),
        upcoming_bills_count: num(raw.upcoming_bills_count),
        upcoming_subscriptions: (raw.upcoming_subscriptions ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          amount: num(s.amount),
          days: num(s.days),
        })),
      };
    },
  });
