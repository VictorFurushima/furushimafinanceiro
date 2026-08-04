import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AppRole = "admin" | "viewer";

export interface RoleState {
  role: AppRole | null;
  isAdmin: boolean;
  isViewer: boolean;
  loading: boolean;
  userId: string | null;
  email: string | null;
}

export const VIEWER_MESSAGE = "Este login é apenas para visualização.";

export function useRole(): RoleState {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user_role", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<AppRole> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role as AppRole);
      return roles.includes("admin") ? "admin" : roles.includes("viewer") ? "viewer" : "viewer";
    },
  });

  return {
    role: data ?? null,
    isAdmin: data === "admin",
    isViewer: data === "viewer",
    loading: authLoading || isLoading,
    userId: user?.id ?? null,
    email: user?.email ?? null,
  };
}
