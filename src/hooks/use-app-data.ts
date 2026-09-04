import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys } from "@/lib/query-keys";

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
    queryKey: financeKeys.investments,
    queryFn: async (): Promise<Investment[]> => {
      const { data, error } = await supabase
        .from("investments")
        .select(
          "id, name, inv_type, institution, invested_amount, current_amount, initial_amount, applied_at, maturity_date, liquidity, risk, objective, notes, status, is_emergency_reserve, color, created_at",
        )
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
    queryKey: financeKeys.investmentEvents(investmentId),
    queryFn: async (): Promise<InvestmentEvent[]> => {
      let q = supabase
        .from("investment_events")
        .select(
          "id, investment_id, event_type, amount, previous_amount, new_amount, occurred_at, account_id, transaction_id, notes, created_at",
        )
        .order("occurred_at", { ascending: false });
      if (investmentId) q = q.eq("investment_id", investmentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((e) => ({ ...e, amount: num(e.amount) })) as InvestmentEvent[];
    },
  });


export const useShoppingItems = () =>
  useQuery({
    queryKey: financeKeys.shoppingItems,
    queryFn: async (): Promise<ShoppingItem[]> => {
      const { data, error } = await supabase
        .from("shopping_items")
        .select(
          "id, item, category_id, store, link, price, shipping, discount, interest, desired_date, priority, purchase_type, payment_method, account_id, card_id, installments, down_payment, notes, image_url, status, score, transaction_id, goal_id, created_at",
        )
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
    queryKey: financeKeys.userSettings,
    queryFn: async (): Promise<UserSettings | null> => {
      const { data, error } = await supabase
        .from("user_settings")
        .select(
          "user_id, min_reserve, max_free_balance_pct, max_income_installment_pct, allow_low_score_wants, min_priority_auto, purchase_alerts, reminder_enabled, reminder_day, reminder_amount, reminder_message, reminder_investment_id, reminder_last_shown",
        )
        .maybeSingle();
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
    queryKey: financeKeys.viewers,
    enabled,

    queryFn: async (): Promise<{ user_id: string; email: string; created_at: string }[]> => {
      const { data, error } = await supabase.rpc("list_my_viewers");
      if (error) throw error;
      return (data ?? []) as { user_id: string; email: string; created_at: string }[];
    },
  });
