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
  ShoppingCart,
  Menu,
  History,
} from "lucide-react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import logo from "@/assets/furushima-logo.jpg";

const itemGroups = [
  {
    label: "Visão e patrimônio",
    items: [
      { to: "/dashboard", label: "Visão Geral", short: "Início", icon: LayoutDashboard },
      { to: "/global-wallet", label: "Carteira Global", short: "Global", icon: Wallet },
      { to: "/investments", label: "Carteira de Investimentos", short: "Invest.", icon: PiggyBank },
      { to: "/accounts", label: "Contas", short: "Contas", icon: Wallet },
      { to: "/cards", label: "Cartões", short: "Cartões", icon: CreditCard },
      { to: "/statistics", label: "Estatísticas", short: "Stats", icon: BarChart3 },
    ],
  },
  {
    label: "Movimentações",
    items: [
      { to: "/transactions", label: "Transações", short: "Gastos", icon: ArrowLeftRight },
      { to: "/income", label: "Receitas", short: "Receitas", icon: ArrowDownToLine },
      { to: "/recharges", label: "Recargas de Saldo", short: "Recargas", icon: Inbox },
      { to: "/timeline", label: "Linha do Tempo", short: "Linha", icon: CalendarClock },
      { to: "/recurring", label: "Assinaturas", short: "Assinaturas", icon: Repeat },
      { to: "/installments", label: "Parcelas", short: "Parcelas", icon: CalendarClock },
    ],
  },
  {
    label: "Planejamento",
    items: [
      { to: "/shopping-planner", label: "Planejador de Compras", short: "Compras", icon: ShoppingCart },
      { to: "/budgets", label: "Orçamentos", short: "Orçamento", icon: Target },
      { to: "/goals", label: "Metas", short: "Metas", icon: Target },
    ],
  },
  {
    label: "Sistema",
    items: [
      { to: "/import-prints", label: "Importar por Print", short: "Prints", icon: ScanLine },
      { to: "/import", label: "Importar CSV", short: "CSV", icon: Upload },
      { to: "/history", label: "Histórico de ações", short: "Histórico", icon: History },
      { to: "/settings", label: "Configurações", short: "Config", icon: Settings },
    ],
  },
] as const;

const items = itemGroups.flatMap((group) => group.items);

const mobileItems = items.filter((i) =>
  ["/dashboard", "/transactions", "/accounts", "/cards"].includes(i.to),
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
    <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-sidebar-border bg-sidebar px-3 py-4">
      <Link to="/dashboard" className="relative flex items-center gap-3 px-2 py-2 mb-5 overflow-hidden">
        <span className="absolute inset-x-2 bottom-0 h-px furushima-brand-line opacity-70" />
        <img
          src={logo}
          alt="Furushima Financeiro"
          className="h-10 w-10 rounded-md object-contain"
        />
        <div className="leading-tight">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.12em] block">Furushima</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Financeiro</span>
        </div>
      </Link>

      <nav className="flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
        {itemGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((it) => {
                const active = path === it.to;
                return (
                  <Link key={it.to} to={it.to} className={cn(
                    "relative flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
                    active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}>
                    <it.icon className={cn("h-4 w-4", active && "text-primary")} />
                    <span className="truncate">{it.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
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
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground transition"
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
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-sidebar-border bg-sidebar/98 px-1 pt-1 shadow-[0_-8px_24px_color-mix(in_oklab,var(--background)_70%,transparent)]"
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
                active ? "bg-sidebar-accent text-primary" : "text-muted-foreground",
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
                moreActive ? "bg-sidebar-accent text-primary" : "text-muted-foreground",
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
                   className="h-9 w-9 rounded-md object-contain"
                />
                 <span><span className="block font-display text-sm font-semibold uppercase tracking-[0.12em]">Furushima</span><span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Financeiro</span></span>
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
                         ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
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
