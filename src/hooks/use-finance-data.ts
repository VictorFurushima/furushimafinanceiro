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

export const useTransactions = (limit?: number) =>
  useQuery({
    queryKey: ["transactions", limit ?? "all"],
    queryFn: async (): Promise<Transaction[]> => {
      const q = supabase
        .from("transactions")
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
      const { data, error } = await supabase
        .from("budgets")
        .select("*, categories(name,color)")
        .eq("month", month);
      if (error) throw error;
      return (data ?? []) as unknown as Budget[];
    },
  });
