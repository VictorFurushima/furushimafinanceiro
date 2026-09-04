import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Target,
  Wallet,
  LogOut,
  Repeat,
  BarChart3,
  Upload,
  Settings,
  ArrowDownToLine,
  Inbox,
  CreditCard,
  CalendarClock,
  ScanLine,
  PiggyBank,
  StickyNote,
  ShoppingCart,
  Menu,
  Sun,
  CalendarDays,
  ListTodo,
} from "lucide-react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import logo from "@/assets/furushima-logo.jpg";

const items = [
  { to: "/dashboard", label: "Visão Geral", short: "Início", icon: LayoutDashboard },
  { to: "/transactions", label: "Transações", short: "Gastos", icon: ArrowLeftRight },
  { to: "/income", label: "Receitas", short: "Receitas", icon: ArrowDownToLine },
  { to: "/investments", label: "Investimentos", short: "Invest.", icon: PiggyBank },
  { to: "/shopping-planner", label: "Planejador de Compras", short: "Compras", icon: ShoppingCart },
  { to: "/notes", label: "Anotações", short: "Notas", icon: StickyNote },
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
  ["/today", "/agenda", "/tasks", "/dashboard"].includes(i.to),
);

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user } = useAuth();
  const { isViewer } = useRole();

  const navigate = useNavigate();

  const logout = async () => {
    await supabase.auth.signOut();
    toast.success("Até logo!");
    navigate({ to: "/login" });
  };

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-sidebar-border bg-sidebar p-4">
      <Link to="/dashboard" className="flex items-center gap-3 px-2 py-3 mb-6">
        <img
          src={logo}
          alt="Furushima Financeiro"
          className="h-10 w-10 rounded-lg object-cover shadow-glow"
        />
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
          {isViewer && (
            <Badge variant="outline" className="mt-1 text-[10px]">
              Modo espectador
            </Badge>
          )}
        </div>

        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { isViewer } = useRole();
  const navigate = useNavigate();

  const logout = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    toast.success("Até logo!");
    navigate({ to: "/login" });
  };

  const moreActive = !mobileItems.some((i) => i.to === path);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar/95 backdrop-blur border-t border-sidebar-border px-1 pt-1"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-stretch justify-around">
        {mobileItems.map((it) => {
          const active = path === it.to;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg text-[10px] leading-tight transition",
                active ? "text-primary-glow" : "text-muted-foreground",
              )}
            >
              <it.icon className="h-5 w-5" />
              <span className="truncate max-w-full">{it.short}</span>
            </Link>
          );
        })}

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Abrir menu completo"
              className={cn(
                "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg text-[10px] leading-tight transition",
                moreActive ? "text-primary-glow" : "text-muted-foreground",
              )}
            >
              <Menu className="h-5 w-5" />
              Mais
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[86vw] max-w-sm p-0 flex flex-col bg-sidebar">
            <SheetHeader className="p-4 pb-3 border-b border-sidebar-border text-left">
              <SheetTitle className="flex items-center gap-3">
                <img
                  src={logo}
                  alt="Furushima Financeiro"
                  className="h-9 w-9 rounded-lg object-cover"
                />
                <span className="font-display">Furushima Financeiro</span>
              </SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-3 space-y-1 overscroll-contain">
              {items.map((it) => {
                const active = path === it.to;
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                      active
                        ? "bg-gradient-primary text-primary-foreground shadow-glow font-medium"
                        : "text-sidebar-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    <it.icon className="h-4.5 w-4.5 shrink-0" />
                    <span className="truncate">{it.label}</span>
                  </Link>
                );
              })}
            </div>

            <div
              className="border-t border-sidebar-border p-3 space-y-2"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
              <div className="px-2">
                <p className="text-xs text-muted-foreground">Conectado como</p>
                <p className="text-sm truncate">{user?.email}</p>
                {isViewer && (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    Modo espectador
                  </Badge>
                )}
              </div>
              <button
                onClick={logout}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
