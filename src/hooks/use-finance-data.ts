import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys, type TransactionFilters } from "@/lib/query-keys";

export type { TransactionFilters };

export interface Transaction {
  id: string;
  amount: number;
  type: "income" | "expense";
  description: string | null;
  occurred_at: string;
  account_id: string | null;
  category_id: string | null;
  subcategory: string | null;
  payment_method: string | null;
  notes: string | null;
  recurring_id: string | null;
  /** real | transfer | contribution | redemption */
  flow?: string | null;
  categories?: { name: string; color: string; icon: string } | null;
  accounts?: { name: string; color: string } | null;
}

export interface Category {
  id: string;
  name: string;
  type: "income" | "expense";
  color: string;
  icon: string;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  color: string;
}

export interface Budget {
  id: string;
  category_id: string;
  amount: number;
  month: string;
  categories?: { name: string; color: string } | null;
}

export interface RecurringExpense {
  id: string;
  name: string;
  amount: number;
  category_id: string | null;
  account_id: string | null;
  payment_method: string | null;
  billing_day: number;
  frequency: "weekly" | "monthly" | "yearly" | "custom";
  start_date: string;
  end_date: string | null;
  status: "active" | "paused" | "cancelled";
  notes: string | null;
  categories?: { name: string; color: string } | null;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  category_id: string | null;
  color: string;
  notes: string | null;
}

export interface CategoryLimit {
  id: string;
  category_id: string;
  monthly_limit: number;
}

export interface BalanceRecharge {
  id: string;
  name: string;
  recharge_type: string;
  expected_amount: number;
  expected_date: string;
  account_id: string | null;
  card_id: string | null;
  payment_method: string | null;
  status: "prevista" | "confirmada" | "recebida" | "atrasada" | "cancelada";
  notes: string | null;
  converted_to_income: boolean;
  is_recurring: boolean;
  recurring_day: number | null;
  source_recharge_id: string | null;
}

export interface CreditCard {
  id: string;
  name: string;
  bank: string | null;
  total_limit: number;
  used_limit: number;
  closing_day: number;
  due_day: number;
  status: string;
  color: string;
}

export interface CreditCardBill {
  id: string;
  card_id: string;
  month: number;
  year: number;
  amount: number;
  due_date: string;
  payment_date: string | null;
  status: "aberta" | "paga" | "atrasada";
}

const TX_COLUMNS =
  "id, amount, type, description, occurred_at, account_id, category_id, subcategory, payment_method, notes, recurring_id, flow, categories(name,color,icon), accounts(name,color)";

/** Evita que o supabase-js analise a string de select no nível de tipos. */
const sel = (s: string): string => s;

export interface TransactionPage {
  rows: Transaction[];
  count: number;
}

/** Lista paginada no servidor. Filtros vão para o PostgREST, não para o browser. */
export const useTransactionsPage = (filters: TransactionFilters) =>
  useQuery({
    queryKey: financeKeys.transactionsList(filters),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<TransactionPage> => {
      const page = filters.page ?? 0;
      const pageSize = filters.pageSize ?? 50;
      let q = supabase
        .from("transactions")
        .select(sel(TX_COLUMNS), { count: "exact" })
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (filters.type && filters.type !== "all") q = q.eq("type", filters.type);
      if (filters.categoryId && filters.categoryId !== "all")
        q = q.eq("category_id", filters.categoryId);
      if (filters.accountId && filters.accountId !== "all")
        q = q.eq("account_id", filters.accountId);
      if (filters.paymentMethod && filters.paymentMethod !== "all")
        q = q.eq("payment_method", filters.paymentMethod);
      if (filters.from) q = q.gte("occurred_at", filters.from);
      if (filters.to) q = q.lte("occurred_at", filters.to);
      if (filters.min) q = q.gte("amount", Number(filters.min));
      if (filters.max) q = q.lte("amount", Number(filters.max));
      if (filters.search) q = q.ilike("description", `%${filters.search}%`);

      const { data, error, count } = await q.returns<Transaction[]>();
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

/** Somente as últimas N transações (dialogs, listas resumidas). */
export const useRecentTransactions = (limit = 10) =>
  useQuery({
    queryKey: financeKeys.transactionsRecent(limit),
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select(sel(TX_COLUMNS))
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<Transaction[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

export const useCategories = () =>
  useQuery({
    queryKey: financeKeys.categories,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, type, color, icon")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

export const useAccounts = () =>
  useQuery({
    queryKey: financeKeys.accounts,
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, type, initial_balance, color")
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((a) => ({
        ...a,
        initial_balance: Number(a.initial_balance),
      })) as Account[];
    },
  });

export const useBudgets = (month: string) =>
  useQuery({
    queryKey: financeKeys.budgets(month),
    queryFn: async (): Promise<Budget[]> => {
      const { data, error } = await supabase
        .from("budgets")
        .select(sel("id, category_id, amount, month, categories(name,color)"))
        .eq("month", month)
        .returns<Budget[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

export const useRecurring = () =>
  useQuery({
    queryKey: financeKeys.recurring,
    queryFn: async (): Promise<RecurringExpense[]> => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select(
          sel(
            "id, name, amount, category_id, account_id, payment_method, billing_day, frequency, start_date, end_date, status, notes, categories(name,color)",
          ),
        )
        .order("billing_day")
        .returns<RecurringExpense[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

export const useGoals = () =>
  useQuery({
    queryKey: financeKeys.goals,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from("goals")
        .select("id, name, target_amount, current_amount, deadline, category_id, color, notes")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Goal[];
    },
  });

export const useCategoryLimits = () =>
  useQuery({
    queryKey: financeKeys.categoryLimits,
    queryFn: async (): Promise<CategoryLimit[]> => {
      const { data, error } = await supabase
        .from("category_limits")
        .select("id, category_id, monthly_limit");
      if (error) throw error;
      return (data ?? []) as CategoryLimit[];
    },
  });

export const useRecharges = () =>
  useQuery({
    queryKey: financeKeys.recharges,
    queryFn: async (): Promise<BalanceRecharge[]> => {
      const { data, error } = await supabase
        .from("balance_recharges")
        .select(
          "id, name, recharge_type, expected_amount, expected_date, account_id, card_id, payment_method, status, notes, converted_to_income, is_recurring, recurring_day, source_recharge_id",
        )
        .order("expected_date", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as BalanceRecharge[]).map((r) => ({
        ...r,
        expected_amount: Number(r.expected_amount),
      }));
    },
  });

export const useCreditCards = () =>
  useQuery({
    queryKey: financeKeys.creditCards,
    queryFn: async (): Promise<CreditCard[]> => {
      const { data, error } = await supabase
        .from("credit_cards")
        .select("id, name, bank, total_limit, used_limit, closing_day, due_day, status, color")
        .order("created_at");
      if (error) throw error;
      return ((data ?? []) as unknown as CreditCard[]).map((c) => ({
        ...c,
        total_limit: Number(c.total_limit),
        used_limit: Number(c.used_limit),
      }));
    },
  });

export const useCreditCardBills = () =>
  useQuery({
    queryKey: financeKeys.creditCardBills,
    queryFn: async (): Promise<CreditCardBill[]> => {
      const { data, error } = await supabase
        .from("credit_card_bills")
        .select("id, card_id, month, year, amount, due_date, payment_date, status")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as CreditCardBill[]).map((b) => ({
        ...b,
        amount: Number(b.amount),
      }));
    },
  });
