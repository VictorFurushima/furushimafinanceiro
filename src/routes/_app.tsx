import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar, MobileNav } from "@/components/app-sidebar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app")({ component: AppLayout });

function AppLayout() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  // Trigger recurring + recharge automation when user enters the app (idempotent, once/day)
  useEffect(() => {
    if (!user) return;
    const key = `furushima:auto-${user.id}-${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    (async () => {
      const [tx, rc, ov] = await Promise.all([
        supabase.rpc("generate_recurring_transactions"),
        supabase.rpc("generate_recurring_recharges"),
        supabase.rpc("mark_overdue_recharges"),
      ]);
      localStorage.setItem(key, "1");
      if ((tx.data ?? 0) > 0) qc.invalidateQueries({ queryKey: ["transactions"] });
      if ((rc.data ?? 0) > 0 || (ov.data ?? 0) > 0) qc.invalidateQueries({ queryKey: ["recharges"] });
    })();
  }, [user, qc]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-primary shadow-glow" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="min-h-screen flex w-full">
      <AppSidebar />
      <main className="flex-1 pb-20 lg:pb-0">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
