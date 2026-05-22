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

  // Trigger recurring expense generation when user enters the app (idempotent)
  useEffect(() => {
    if (!user) return;
    const key = `furushima:recurring-${user.id}-${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    supabase.rpc("generate_recurring_transactions").then(({ data, error }) => {
      if (error) return;
      localStorage.setItem(key, "1");
      if ((data ?? 0) > 0) qc.invalidateQueries({ queryKey: ["transactions"] });
    });
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
