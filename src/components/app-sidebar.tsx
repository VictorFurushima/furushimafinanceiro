import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, ArrowLeftRight, Target, Wallet, LogOut,
  Repeat, BarChart3, Upload, Settings, ArrowDownToLine,
  Inbox, CreditCard, CalendarClock, ScanLine,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import logo from "@/assets/furushima-logo.jpg";

const items = [
  { to: "/dashboard", label: "Visão Geral", short: "Início", icon: LayoutDashboard },
  { to: "/transactions", label: "Transações", short: "Gastos", icon: ArrowLeftRight },
  { to: "/income", label: "Receitas", short: "Receitas", icon: ArrowDownToLine },
  { to: "/recharges", label: "Recargas de Saldo", short: "Recargas", icon: Inbox },
  { to: "/cards", label: "Cartões", short: "Cartões", icon: CreditCard },
  { to: "/timeline", label: "Linha do Tempo", short: "Linha", icon: CalendarClock },
  { to: "/recurring", label: "Assinaturas", short: "Assinaturas", icon: Repeat },
  { to: "/budgets", label: "Orçamentos", short: "Orçamento", icon: Target },
  { to: "/goals", label: "Metas", short: "Metas", icon: Target },
  { to: "/statistics", label: "Estatísticas", short: "Stats", icon: BarChart3 },
  { to: "/accounts", label: "Contas", short: "Contas", icon: Wallet },
  { to: "/import-prints", label: "Importar por Print", short: "Prints", icon: ScanLine },
  { to: "/import", label: "Importar CSV", short: "CSV", icon: Upload },
  { to: "/settings", label: "Configurações", short: "Config", icon: Settings },
] as const;

const mobileItems = items.filter((i) =>
  ["/dashboard", "/transactions", "/income", "/import-prints", "/recharges", "/recurring", "/settings"].includes(i.to),
);

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
      <Link to="/dashboard" className="flex items-center gap-3 px-2 py-3 mb-6">
        <img src={logo} alt="Furushima Financeiro" className="h-10 w-10 rounded-lg object-cover shadow-glow" />
        <div className="leading-tight">
          <span className="font-display text-lg font-bold block">Furushima</span>
          <span className="text-xs text-muted-foreground">Financeiro</span>
        </div>
      </Link>

      <nav className="space-y-1 flex-1 overflow-y-auto">
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

      <div className="border-t border-sidebar-border pt-4 space-y-2 mt-4">
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
        {mobileItems.map((it) => {
          const active = path === it.to;
          return (
            <Link key={it.to} to={it.to} className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-[10px] transition",
              active ? "text-primary-glow" : "text-muted-foreground"
            )}>
              <it.icon className="h-5 w-5" />
              {it.short}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
