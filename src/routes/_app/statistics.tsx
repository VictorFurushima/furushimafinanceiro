import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTransactions, useCategories, useAccounts } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { paymentLabel } from "@/lib/finance-constants";

export const Route = createFileRoute("/_app/statistics")({ component: StatisticsPage });

function StatisticsPage() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const [months, setMonths] = useState(6);

  const now = new Date();
  const monthlyData = useMemo(() => {
    const arr: { label: string; income: number; expense: number; net: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const tx = transactions.filter((t) => {
        const dt = new Date(t.occurred_at);
        return dt >= d && dt < next;
      });
      const inc = tx.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
      const exp = tx.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
      arr.push({
        label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        income: inc, expense: exp, net: inc - exp,
      });
    }
    return arr;
  }, [transactions, months]);

  const thisMonth = transactions.filter((t) => {
    const d = new Date(t.occurred_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === "expense";
  });
  const lastMonth = transactions.filter((t) => {
    const d = new Date(t.occurred_at);
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getMonth() === last.getMonth() && d.getFullYear() === last.getFullYear() && t.type === "expense";
  });

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayElapsed = now.getDate();
  const totalThisMonth = thisMonth.reduce((s, t) => s + Number(t.amount), 0);
  const dailyAvg = totalThisMonth / Math.max(1, dayElapsed);
  const weeklyAvg = dailyAvg * 7;

  const catCompare = useMemo(() => {
    const cur = new Map<string, number>();
    const prev = new Map<string, number>();
    thisMonth.forEach((t) => t.category_id && cur.set(t.category_id, (cur.get(t.category_id) ?? 0) + Number(t.amount)));
    lastMonth.forEach((t) => t.category_id && prev.set(t.category_id, (prev.get(t.category_id) ?? 0) + Number(t.amount)));
    const result: { name: string; cur: number; prev: number; delta: number; color: string }[] = [];
    categories.forEach((c) => {
      const cc = cur.get(c.id) ?? 0; const pp = prev.get(c.id) ?? 0;
      if (cc > 0 || pp > 0) result.push({ name: c.name, cur: cc, prev: pp, delta: cc - pp, color: c.color });
    });
    return result.sort((a, b) => b.cur - a.cur);
  }, [thisMonth, lastMonth, categories]);

  const grew = [...catCompare].filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const shrunk = [...catCompare].filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta)[0];

  const dayHeat = useMemo(() => {
    const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const arr = days.map((d) => ({ day: d, total: 0 }));
    transactions.filter((t) => t.type === "expense").forEach((t) => {
      arr[new Date(t.occurred_at).getDay()].total += Number(t.amount);
    });
    return arr;
  }, [transactions]);

  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    transactions.filter((t) => t.type === "expense" && t.payment_method).forEach((t) => {
      map.set(t.payment_method!, (map.get(t.payment_method!) ?? 0) + Number(t.amount));
    });
    return Array.from(map.entries()).map(([k, v]) => ({ name: paymentLabel(k), value: v })).sort((a, b) => b.value - a.value);
  }, [transactions]);

  const top10 = [...transactions.filter((t) => t.type === "expense")].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10);

  const balanceEvo = useMemo(() => {
    const initial = accounts.reduce((s, a) => s + Number(a.initial_balance), 0);
    const sorted = [...transactions].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
    let bal = initial;
    return sorted.map((t) => {
      bal += t.type === "income" ? Number(t.amount) : -Number(t.amount);
      return { date: new Date(t.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), balance: bal };
    });
  }, [transactions, accounts]);

  const PALETTE = ["#22d3ee", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="font-display text-4xl font-bold">Estatísticas</h1>
        <Select value={String(months)} onValueChange={(v) => setMonths(parseInt(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Gasto este mês" value={formatCurrency(totalThisMonth)} />
        <StatBox label="Média diária" value={formatCurrency(dailyAvg)} hint={`em ${dayElapsed} de ${daysInMonth} dias`} />
        <StatBox label="Média semanal" value={formatCurrency(weeklyAvg)} />
        <StatBox label="Mês passado" value={formatCurrency(lastMonth.reduce((s, t) => s + Number(t.amount), 0))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Receitas vs Despesas</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.05 215)" />
                  <XAxis dataKey="label" stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <YAxis stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.04 220)", border: "1px solid oklch(0.28 0.05 215)", borderRadius: 12 }} formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="income" fill="oklch(0.74 0.15 165)" radius={[4, 4, 0, 0]} name="Receitas" />
                  <Bar dataKey="expense" fill="oklch(0.62 0.22 25)" radius={[4, 4, 0, 0]} name="Despesas" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Gastos por dia da semana</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={dayHeat}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.05 215)" />
                  <XAxis dataKey="day" stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <YAxis stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.04 220)", border: "1px solid oklch(0.28 0.05 215)", borderRadius: 12 }} formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="total" fill="oklch(0.78 0.13 195)" radius={[4, 4, 0, 0]} name="Total" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Evolução do saldo</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={balanceEvo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.05 215)" />
                  <XAxis dataKey="date" stroke="oklch(0.70 0.03 210)" fontSize={11} />
                  <YAxis stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.04 220)", border: "1px solid oklch(0.28 0.05 215)", borderRadius: 12 }} formatter={(v: number) => formatCurrency(v)} />
                  <Line type="monotone" dataKey="balance" stroke="oklch(0.78 0.13 195)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Formas de pagamento</CardTitle></CardHeader>
          <CardContent>
            {paymentBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">Sem dados de forma de pagamento.</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={paymentBreakdown} dataKey="value" innerRadius={55} outerRadius={90} paddingAngle={3}>
                      {paymentBreakdown.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "oklch(0.18 0.04 220)", border: "1px solid oklch(0.28 0.05 215)", borderRadius: 12 }} formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Comparação com mês anterior</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {catCompare.slice(0, 8).map((c) => {
                const delta = c.delta;
                return (
                  <li key={c.name} className="flex items-center justify-between text-sm py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted-foreground text-xs">{formatCurrency(c.prev)} → {formatCurrency(c.cur)}</span>
                      <span className={`font-medium ${delta > 0 ? "text-destructive" : delta < 0 ? "text-success" : "text-muted-foreground"}`}>
                        {delta > 0 ? "+" : ""}{formatCurrency(delta)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {grew && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs">
                <strong className="text-destructive">Maior crescimento:</strong> {grew.name} (+{formatCurrency(grew.delta)})
              </div>
            )}
            {shrunk && (
              <div className="mt-2 p-3 rounded-lg bg-success/10 border border-success/20 text-xs">
                <strong className="text-success">Maior redução:</strong> {shrunk.name} ({formatCurrency(shrunk.delta)})
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Top 10 maiores gastos</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {top10.map((t, i) => (
                <li key={t.id} className="flex items-center justify-between text-sm py-1.5">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <span className="truncate">{t.description || t.categories?.name || "—"}</span>
                  </span>
                  <span className="font-semibold text-destructive shrink-0 ml-2">{formatCurrency(Number(t.amount))}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="bg-gradient-card border-border/50 shadow-card">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-2 font-display text-xl lg:text-2xl font-bold">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}
