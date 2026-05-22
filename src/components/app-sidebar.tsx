import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, ArrowLeftRight, Target, Wallet, LogOut } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const items = [
  { to: "/dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { to: "/transactions", label: "Transações", icon: ArrowLeftRight },
  { to: "/budgets", label: "Orçamentos", icon: Target },
  { to: "/accounts", label: "Contas", icon: Wallet },
] as const;

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user } = useAuth();
  const navigate = useNavigate();

  const logout = async () => {
    await supabase.auth.signOut();
    toast.success("Até logo!");
    navigate({ to: "/login" });
  };

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-sidebar-border bg-sidebar p-4">
      <Link to="/dashboard" className="flex items-center gap-2 px-2 py-3 mb-6">
        <div className="h-9 w-9 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
          <Wallet className="h-4.5 w-4.5 text-primary-foreground" />
        </div>
        <span className="font-display text-xl font-bold">Cofre</span>
      </Link>

      <nav className="space-y-1 flex-1">
        {items.map((it) => {
          const active = path === it.to;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                active
                  ? "bg-gradient-primary text-primary-foreground shadow-glow font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent",
              )}
            >
              <it.icon className="h-4.5 w-4.5" />
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border pt-4 space-y-2">
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">Conectado como</p>
          <p className="text-sm truncate">{user?.email}</p>
        </div>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition">
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar/95 backdrop-blur border-t border-sidebar-border px-2 py-2">
      <div className="flex items-center justify-around">
        {items.map((it) => {
          const active = path === it.to;
          return (
            <Link key={it.to} to={it.to} className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs transition",
              active ? "text-primary-glow" : "text-muted-foreground"
            )}>
              <it.icon className="h-5 w-5" />
              {it.label.split(" ")[0]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
