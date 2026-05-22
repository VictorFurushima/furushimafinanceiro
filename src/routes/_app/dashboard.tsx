import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight, Plus,
  PiggyBank, Percent, Crown, Calendar, Repeat,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAccounts, useCategories, useRecurring, useTransactions } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { TransactionDialog } from "@/components/transaction-dialog";
import { StatCard } from "@/components/stat-card";

export const Route = createFileRoute("/_app/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const { data: transactions = [] } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: recurring = [] } = useRecurring();
  const [openTx, setOpenTx] = useState(false);

  const now = new Date();
  const thisMonth = transactions.filter((t) => {
    const d = new Date(t.occurred_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = transactions.filter((t) => {
    const d = new Date(t.occurred_at);
    return d.getMonth() === lastMonthDate.getMonth() && d.getFullYear() === lastMonthDate.getFullYear();
  });

  const income = thisMonth.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = thisMonth.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const lastExpense = lastMonth.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const economy = income - expense;
  const pctSpent = income > 0 ? (expense / income) * 100 : 0;
  const deltaVsLast = lastExpense > 0 ? ((expense - lastExpense) / lastExpense) * 100 : 0;

  const balance =
    accounts.reduce((s, a) => s + Number(a.initial_balance), 0) +
    transactions.reduce((s, t) => s + (t.type === "income" ? Number(t.amount) : -Number(t.amount)), 0);

  const monthlyData = useMemo(() => {
    const months: { label: string; key: string; income: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        key: `${d.getFullYear()}-${d.getMonth()}`, income: 0, expense: 0,
      });
    }
    transactions.forEach((t) => {
      const d = new Date(t.occurred_at);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      const m = months.find((x) => x.key === k);
      if (m) { if (t.type === "income") m.income += Number(t.amount); else m.expense += Number(t.amount); }
    });
    return months;
  }, [transactions]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color: string }>();
    thisMonth.filter((t) => t.type === "expense").forEach((t) => {
      const cat = categories.find((c) => c.id === t.category_id);
      const key = cat?.id ?? "none";
      const cur = map.get(key) ?? { name: cat?.name ?? "Sem categoria", value: 0, color: cat?.color ?? "#64748b" };
      cur.value += Number(t.amount);
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [thisMonth, categories]);

  const topCategory = byCategory[0];
  const recent = transactions.slice(0, 6);

  const upcomingSubs = useMemo(() => {
    return recurring
      .filter((r) => r.status === "active" && r.frequency === "monthly")
      .map((r) => {
        const next = new Date(now.getFullYear(), now.getMonth(), r.billing_day);
        if (next < now) next.setMonth(next.getMonth() + 1);
        return { ...r, next, days: Math.ceil((next.getTime() - now.getTime()) / 86400000) };
      })
      .sort((a, b) => a.days - b.days)
      .slice(0, 4);
  }, [recurring]);

  return (
    <div className="p-6 lg:p-10 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground capitalize">
            {now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="font-display text-4xl font-bold mt-1">Visão Geral</h1>
        </div>
        <Button onClick={() => setOpenTx(true)} className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90">
          <Plus className="h-4 w-4 mr-2" /> Nova transação
        </Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Saldo total" value={formatCurrency(balance)} icon={Wallet} gradient />
        <StatCard label="Receitas do mês" value={formatCurrency(income)} icon={ArrowUpRight} accent="success" />
        <StatCard label="Despesas do mês" value={formatCurrency(expense)} icon={ArrowDownRight} accent="destructive"
          hint={lastExpense > 0 ? `${deltaVsLast > 0 ? "+" : ""}${deltaVsLast.toFixed(0)}% vs mês passado` : undefined} />
        <StatCard label="Economia" value={formatCurrency(economy)} icon={PiggyBank} accent={economy >= 0 ? "success" : "destructive"} />
        <StatCard label="% renda gasta" value={`${pctSpent.toFixed(0)}%`} icon={Percent} accent={pctSpent > 80 ? "destructive" : pctSpent > 50 ? "warning" : "success"} />
        <StatCard label="Maior categoria" value={topCategory?.name ?? "—"} icon={Crown}
          hint={topCategory ? formatCurrency(topCategory.value) : undefined} />
        <StatCard label="Assinaturas ativas" value={String(recurring.filter((r) => r.status === "active").length)} icon={Repeat} />
        <StatCard label="Transações no mês" value={String(thisMonth.length)} icon={Calendar} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Evolução — últimos 6 meses</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="grad-income" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.74 0.15 165)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.74 0.15 165)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grad-expense" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.62 0.22 25)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.62 0.22 25)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.05 215)" />
                  <XAxis dataKey="label" stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <YAxis stroke="oklch(0.70 0.03 210)" fontSize={12} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.04 220)", border: "1px solid oklch(0.28 0.05 215)", borderRadius: 12 }} formatter={(v: number) => formatCurrency(v)} />
                  <Area type="monotone" dataKey="income" stroke="oklch(0.74 0.15 165)" fill="url(#grad-income)" strokeWidth={2} name="Receitas" />
                  <Area type="monotone" dataKey="expense" stroke="oklch(0.62 0.22 25)" fill="url(#grad-expense)" strokeWidth={2} name="Despesas" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Despesas por categoria</CardTitle></CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">Sem despesas neste mês.</p>
            ) : (
              <>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byCategory} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={3}>
                        {byCategory.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "oklch(0.18 0.04 220)", border: "1px solid oklch(0.28 0.05 215)", borderRadius: 12 }} formatter={(v: number) => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 mt-2">
                  {byCategory.slice(0, 4).map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                      <span className="font-medium">{formatCurrency(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Transações recentes</CardTitle></CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma transação ainda. Clique em "Nova transação" para começar.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {recent.map((t) => (
                  <li key={t.id} className="flex items-center gap-4 py-3">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${t.categories?.color ?? "#22d3ee"}25`, color: t.categories?.color ?? "#22d3ee" }}>
                      {t.type === "income" ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.description || t.categories?.name || "Transação"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.categories?.name ?? "Sem categoria"} · {new Date(t.occurred_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${t.type === "income" ? "text-success" : "text-destructive"}`}>
                      {t.type === "income" ? "+" : "−"} {formatCurrency(Number(t.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Próximas assinaturas</CardTitle></CardHeader>
          <CardContent>
            {upcomingSubs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma assinatura ativa.</p>
            ) : (
              <ul className="space-y-2">
                {upcomingSubs.map((s) => (
                  <li key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/40">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.days === 0 ? "Hoje" : `Em ${s.days} dia${s.days > 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-destructive">{formatCurrency(Number(s.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <TransactionDialog open={openTx} onOpenChange={setOpenTx} />
    </div>
  );
}
