import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys } from "@/lib/query-keys";

export interface InstallmentsResult {
  count: number;
  summary: {
    active_count: number;
    remaining_amount: number;
    current_month_amount: number;
    overdue_amount: number;
  };
  forecast: { month: string; amount: number }[];
  rows: {
    id: string;
    description: string | null;
    amount: number;
    occurred_at: string;
    installment_count: number;
    card_name: string;
    category_name: string | null;
    paid_count: number;
    overdue_count: number;
    paid_amount: number;
    remaining_amount: number;
    next_due_date: string | null;
    last_due_date: string;
    installments: {
      number: number;
      amount: number;
      due_date: string;
      payment_date: string | null;
      bill_id: string;
      status: "paid" | "pending" | "overdue";
    }[];
  }[];
}

export function useInstallments(card: string, status: string, search: string, page: number) {
  return useQuery({
    queryKey: financeKeys.installmentsList(card, status, search, page),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_installments", {
        p_card_id: card === "all" ? undefined : card,
        p_status: status,
        p_search: search,
        p_page: page,
        p_page_size: 20,
      });
      if (error) throw error;
      return data as unknown as InstallmentsResult;
    },
  });
}
