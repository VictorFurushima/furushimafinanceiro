import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Investment {
  id: string;
  name: string;
  inv_type: string;
  institution: string | null;
  invested_amount: number;
  current_amount: number;
  initial_amount: number;
  applied_at: string;
  maturity_date: string | null;
  liquidity: string;
  risk: string;
  objective: string | null;
  notes: string | null;
  status: string;
  is_emergency_reserve: boolean;
  color: string;
  created_at: string;
}

export interface InvestmentEvent {
  id: string;
  investment_id: string;
  event_type: string;
  amount: number;
  previous_amount: number | null;
  new_amount: number | null;
  occurred_at: string;
  account_id: string | null;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  note_date: string;
  link_type: string;
  link_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShoppingItem {
  id: string;
  item: string;
  category_id: string | null;
  store: string | null;
  link: string | null;
  price: number;
  shipping: number;
  discount: number;
  interest: number;
  desired_date: string | null;
  priority: string;
  purchase_type: string;
  payment_method: string;
  account_id: string | null;
  card_id: string | null;
  installments: number;
  down_payment: number;
  notes: string | null;
  image_url: string | null;
  status: string;
  score: number | null;
  transaction_id: string | null;
  goal_id: string | null;
  created_at: string;
}

export interface UserSettings {
  user_id: string;
  min_reserve: number;
  max_free_balance_pct: number;
  max_income_installment_pct: number;
  allow_low_score_wants: boolean;
  min_priority_auto: string;
  purchase_alerts: boolean;
  reminder_enabled: boolean;
  reminder_day: number;
  reminder_amount: number;
  reminder_message: string | null;
  reminder_investment_id: string | null;
  reminder_last_shown: string | null;
}

export const DEFAULT_SETTINGS: Omit<UserSettings, "user_id"> = {
  min_reserve: 0,
  max_free_balance_pct: 30,
  max_income_installment_pct: 20,
  allow_low_score_wants: false,
  min_priority_auto: "media",
  purchase_alerts: true,
  reminder_enabled: false,
  reminder_day: 5,
  reminder_amount: 0,
  reminder_message: null,
  reminder_investment_id: null,
  reminder_last_shown: null,
};

const num = (v: unknown) => Number(v ?? 0);

export const useInvestments = () =>
  useQuery({
    queryKey: ["investments"],
    queryFn: async (): Promise<Investment[]> => {
      const { data, error } = await supabase
        .from("investments")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((i) => ({
        ...i,
        invested_amount: num(i.invested_amount),
        current_amount: num(i.current_amount),
        initial_amount: num(i.initial_amount),
      })) as Investment[];
    },
  });

export const useInvestmentEvents = (investmentId?: string) =>
  useQuery({
    queryKey: ["investment_events", investmentId ?? "all"],
    queryFn: async (): Promise<InvestmentEvent[]> => {
      let q = supabase.from("investment_events").select("*").order("occurred_at", { ascending: false });
      if (investmentId) q = q.eq("investment_id", investmentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((e) => ({ ...e, amount: num(e.amount) })) as InvestmentEvent[];
    },
  });

export const useNotes = () =>
  useQuery({
    queryKey: ["notes"],
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .order("note_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Note[];
    },
  });

export const useShoppingItems = () =>
  useQuery({
    queryKey: ["shopping_items"],
    queryFn: async (): Promise<ShoppingItem[]> => {
      const { data, error } = await supabase
        .from("shopping_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((s) => ({
        ...s,
        price: num(s.price),
        shipping: num(s.shipping),
        discount: num(s.discount),
        interest: num(s.interest),
        down_payment: num(s.down_payment),
      })) as ShoppingItem[];
    },
  });

export const useUserSettings = () =>
  useQuery({
    queryKey: ["user_settings"],
    queryFn: async (): Promise<UserSettings | null> => {
      const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        min_reserve: num(data.min_reserve),
        max_free_balance_pct: num(data.max_free_balance_pct),
        max_income_installment_pct: num(data.max_income_installment_pct),
        reminder_amount: num(data.reminder_amount),
      } as UserSettings;
    },
  });

export const useViewers = (enabled: boolean) =>
  useQuery({
    queryKey: ["my_viewers"],
    enabled,
    queryFn: async (): Promise<{ user_id: string; email: string; created_at: string }[]> => {
      const { data, error } = await supabase.rpc("list_my_viewers");
      if (error) throw error;
      return (data ?? []) as { user_id: string; email: string; created_at: string }[];
    },
  });
