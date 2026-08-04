import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  id: string; name: string; type: "income" | "expense"; color: string; icon: string;
}

export interface Account {
  id: string; name: string; type: string; initial_balance: number; color: string;
}

export interface Budget {
  id: string; category_id: string; amount: number; month: string;
  categories?: { name: string; color: string } | null;
}

export interface RecurringExpense {
  id: string; name: string; amount: number;
  category_id: string | null; account_id: string | null;
  payment_method: string | null;
  billing_day: number;
  frequency: "weekly" | "monthly" | "yearly" | "custom";
  start_date: string; end_date: string | null;
  status: "active" | "paused" | "cancelled";
  notes: string | null;
  categories?: { name: string; color: string } | null;
}

export interface Goal {
  id: string; name: string; target_amount: number; current_amount: number;
  deadline: string | null; category_id: string | null; color: string; notes: string | null;
}

export interface CategoryLimit { id: string; category_id: string; monthly_limit: number; }

export interface BalanceRecharge {
  id: string; name: string;
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
  id: string; name: string; bank: string | null;
  total_limit: number; used_limit: number;
  closing_day: number; due_day: number;
  status: string; color: string;
}

export interface CreditCardBill {
  id: string; card_id: string;
  month: number; year: number;
  amount: number; due_date: string;
  payment_date: string | null;
  status: "aberta" | "paga" | "atrasada";
}

export const useTransactions = (limit?: number) =>
  useQuery({
    queryKey: ["transactions", limit ?? "all"],
    queryFn: async (): Promise<Transaction[]> => {
      const q = supabase.from("transactions")
        .select("*, categories(name,color,icon), accounts(name,color)")
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false });
      const { data, error } = limit ? await q.limit(limit) : await q;
      if (error) throw error;
      return (data ?? []) as unknown as Transaction[];
    },
  });

export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

export const useAccounts = () =>
  useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase.from("accounts").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []).map((a) => ({ ...a, initial_balance: Number(a.initial_balance) })) as Account[];
    },
  });

export const useBudgets = (month: string) =>
  useQuery({
    queryKey: ["budgets", month],
    queryFn: async (): Promise<Budget[]> => {
      const { data, error } = await supabase.from("budgets")
        .select("*, categories(name,color)").eq("month", month);
      if (error) throw error;
      return (data ?? []) as unknown as Budget[];
    },
  });

export const useRecurring = () =>
  useQuery({
    queryKey: ["recurring"],
    queryFn: async (): Promise<RecurringExpense[]> => {
      const { data, error } = await supabase.from("recurring_expenses")
        .select("*, categories(name,color)").order("billing_day");
      if (error) throw error;
      return (data ?? []) as unknown as RecurringExpense[];
    },
  });

export const useGoals = () =>
  useQuery({
    queryKey: ["goals"],
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase.from("goals").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as Goal[];
    },
  });

export const useCategoryLimits = () =>
  useQuery({
    queryKey: ["category_limits"],
    queryFn: async (): Promise<CategoryLimit[]> => {
      const { data, error } = await supabase.from("category_limits").select("*");
      if (error) throw error;
      return (data ?? []) as CategoryLimit[];
    },
  });

export const useRecharges = () =>
  useQuery({
    queryKey: ["recharges"],
    queryFn: async (): Promise<BalanceRecharge[]> => {
      const { data, error } = await supabase.from("balance_recharges")
        .select("*").order("expected_date", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as BalanceRecharge[]).map((r) => ({
        ...r, expected_amount: Number(r.expected_amount),
      }));
    },
  });

export const useCreditCards = () =>
  useQuery({
    queryKey: ["credit_cards"],
    queryFn: async (): Promise<CreditCard[]> => {
      const { data, error } = await supabase.from("credit_cards")
        .select("*").order("created_at");
      if (error) throw error;
      return ((data ?? []) as unknown as CreditCard[]).map((c) => ({
        ...c, total_limit: Number(c.total_limit), used_limit: Number(c.used_limit),
      }));
    },
  });

export const useCreditCardBills = () =>
  useQuery({
    queryKey: ["credit_card_bills"],
    queryFn: async (): Promise<CreditCardBill[]> => {
      const { data, error } = await supabase.from("credit_card_bills")
        .select("*").order("due_date", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as CreditCardBill[]).map((b) => ({
        ...b, amount: Number(b.amount),
      }));
    },
  });
