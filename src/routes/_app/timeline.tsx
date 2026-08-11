import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowDownToLine, FileText, CreditCard, Repeat } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useRecharges,
  useCreditCardBills,
  useCreditCards,
  useRecurring,
} from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { rechargeTypeLabel, rechargeTypeColor, rechargeStatusLabel } from "@/lib/finance-constants";

export const Route = createFileRoute("/_app/timeline")({ component: TimelinePage });

type TimelineEvent = {
  id: string;
  date: Date;
  title: string;
  subtitle: string;
  amount: number;
  kind: "recharge" | "bill" | "subscription";
  color: string;
  icon: typeof ArrowDownToLine;
  positive: boolean;
};

function TimelinePage() {
  const { data: recharges = [] } = useRecharges();
  const { data: bills = [] } = useCreditCardBills();
  const { data: cards = [] } = useCreditCards();
  const { data: recurring = [] } = useRecurring();

  const events = useMemo<TimelineEvent[]>(() => {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);
    const list: TimelineEvent[] = [];

    recharges.forEach((r) => {
      const d = new Date(r.expected_date);
      if (d < now || d > horizon) return;
      if (r.status === "cancelada" || r.status === "recebida") return;
      list.push({
        id: `r-${r.id}`,
        date: d,
        title: r.name,
        subtitle: `${rechargeTypeLabel(r.recharge_type)} · ${rechargeStatusLabel(r.status)}`,
        amount: r.expected_amount,
        kind: "recharge",
        color: rechargeTypeColor(r.recharge_type),
        icon: r.recharge_type === "limit_release" ? CreditCard : ArrowDownToLine,
        positive: true,
      });
    });

    bills.forEach((b) => {
      const d = new Date(b.due_date);
      if (d < now || d > horizon) return;
      if (b.status === "paga") return;
      const card = cards.find((c) => c.id === b.card_id);
      list.push({
        id: `b-${b.id}`,
        date: d,
        title: `Fatura ${card?.name ?? "cartão"}`,
        subtitle: `Vencimento ${b.month}/${b.year}`,
        amount: b.amount,
        kind: "bill",
        color: "oklch(0.62 0.22 25)",
        icon: FileText,
        positive: false,
      });
    });

    recurring.forEach((s) => {
      if (s.status !== "active" || s.frequency !== "monthly") return;
      const next = new Date(now.getFullYear(), now.getMonth(), s.billing_day);
      if (next < now) next.setMonth(next.getMonth() + 1);
      if (next > horizon) return;
      list.push({
        id: `s-${s.id}`,
        date: next,
        title: s.name,
        subtitle: "Assinatura mensal",
        amount: Number(s.amount),
        kind: "subscription",
        color: "oklch(0.65 0.18 320)",
        icon: Repeat,
        positive: false,
      });
    });

    return list.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [recharges, bills, cards, recurring]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    events.forEach((e) => {
      const key = e.date.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-4xl mx-auto">
      <header>
        <p className="text-sm text-muted-foreground">Próximos 60 dias</p>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">
          Linha do Tempo Financeira
        </h1>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Eventos futuros</CardTitle>
        </CardHeader>
        <CardContent>
          {grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhum evento previsto nos próximos 60 dias.
            </p>
          ) : (
            <div className="relative pl-6 border-l border-border/50 space-y-6">
              {grouped.map(([day, items]) => {
                const date = new Date(day);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const days = Math.ceil((date.getTime() - today.getTime()) / 86400000);
                return (
                  <div key={day} className="relative">
                    <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-gradient-primary shadow-glow" />
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="font-display text-sm font-semibold">
                        {date.toLocaleDateString("pt-BR", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </h3>
                      <Badge variant="outline" className="text-[10px]">
                        {days === 0 ? "Hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`}
                      </Badge>
                    </div>
                    <ul className="space-y-2">
                      {items.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40"
                        >
                          <div
                            className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: `${e.color}25`, color: e.color }}
                          >
                            <e.icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{e.title}</p>
                            <p className="text-xs text-muted-foreground">{e.subtitle}</p>
                          </div>
                          <span
                            className={`text-sm font-semibold ${e.positive ? "text-success" : "text-destructive"}`}
                          >
                            {e.positive ? "+" : "−"} {formatCurrency(e.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
