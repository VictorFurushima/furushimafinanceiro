import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys } from "@/lib/query-keys";
import type { FinancialHistory, FinancialActionDetail } from "@/lib/financial-history";
export interface HistoryFilters {
  page: number;
  status: string;
  table: string;
  from: string;
  to: string;
  search: string;
}
export function useFinancialHistory(filters: HistoryFilters) {
  return useQuery({
    queryKey: financeKeys.historyList(filters),
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_financial_history", {
        p_page: filters.page,
        p_page_size: 25,
        p_status: filters.status,
        p_table: filters.table,
        p_from: filters.from || undefined,
        p_to: filters.to || undefined,
        p_search: filters.search,
      });
      if (error) throw error;
      return data as unknown as FinancialHistory;
    },
  });
}
export function useFinancialAction(id: string) {
  return useQuery({
    queryKey: financeKeys.historyDetail(id),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_financial_action", { p_action_id: id });
      if (error) throw error;
      return data as unknown as FinancialActionDetail;
    },
  });
}
