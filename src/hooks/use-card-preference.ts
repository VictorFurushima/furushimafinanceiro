import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys } from "@/lib/query-keys";
import { friendlyError } from "@/lib/friendly-error";
export function useCardPreference() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = financeKeys.cardPreference(user?.id ?? "");
  const query = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("primary_card_id,primary_card_prompt_dismissed")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? { primary_card_id: null, primary_card_prompt_dismissed: false };
    },
  });
  const mutation = useMutation({
    mutationFn: async (preference: {
      primary_card_id?: string | null;
      primary_card_prompt_dismissed?: boolean;
    }) => {
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, ...preference }, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  return { ...query, savePreference: mutation.mutateAsync, saving: mutation.isPending };
}
