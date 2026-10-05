import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar, MobileNav } from "@/components/app-sidebar";

export const Route = createFileRoute("/_app")({ component: AppLayout });

function AppLayout() {
  const { user, loading } = useAuth();

  // A automação de recorrências/recargas roda no backend (pg_cron:
  // private.run_financial_daily_maintenance, diariamente às 03:10 America/Sao_Paulo).

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-primary shadow-glow" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="min-h-screen flex w-full overflow-x-hidden furushima-loop before:fixed before:-right-16 before:top-20 before:opacity-40 after:fixed after:-right-16 after:top-20 after:opacity-40">
      <AppSidebar />
      <main className="flex-1 min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
        <Outlet />
      </main>

      <MobileNav />
    </div>
  );
}
