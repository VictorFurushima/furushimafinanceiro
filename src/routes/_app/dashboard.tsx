import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight, Plus } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { TransactionDialog } from "@/components/transaction-dialog";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: transactions = [] } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const [openTx, setOpenTx] = useState(false);

  const now = new Date();
  const thisMonth = transactions.filter((t) => {
    const d = new Date(t.occurred_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const income = thisMonth.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = thisMonth.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const balance =
    accounts.reduce((s, a) => s + Number(a.initial_balance), 0) +
    transactions.reduce((s, t) => s + (t.type === "income" ? Number(t.amount) : -Number(t.amount)), 0);

  // Monthly evolution last 6 months
  const monthlyData = useMemo(() => {
    const months: { label: string; key: string; income: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        income: 0,
        expense: 0,
      });
    }
    transactions.forEach((t) => {
      const d = new Date(t.occurred_at);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      const m = months.find((x) => x.key === k);
      if (m) {
        if (t.type === "income") m.income += Number(t.amount);
        else m.expense += Number(t.amount);
      }
    });
    return months;
  }, [transactions]);

  // Expenses by category
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

  const recent = transactions.slice(0, 6);

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="font-display text-4xl font-bold mt-1">Visão Geral</h1>
        </div>
        <Button onClick={() => setOpenTx(true)} className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90">
          <Plus className="h-4 w-4 mr-2" /> Nova transação
        </Button>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Saldo total"
          value={formatCurrency(balance)}
          icon={Wallet}
          gradient
        />
        <StatCard
          label="Receitas do mês"
          value={formatCurrency(income)}
          icon={ArrowUpRight}
          accent="success"
        />
        <StatCard
          label="Despesas do mês"
          value={formatCurrency(expense)}
          icon={ArrowDownRight}
          accent="destructive"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-gradient-card border-border/50 shadow-card">
          <CardHeader>
            <CardTitle className="font-display">Evolução — últimos 6 meses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="grad-income" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.70 0.17 160)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.70 0.17 160)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grad-expense" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.62 0.22 25)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.62 0.22 25)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.26 0.05 282)" />
                  <XAxis dataKey="label" stroke="oklch(0.68 0.04 275)" fontSize={12} />
                  <YAxis stroke="oklch(0.68 0.04 275)" fontSize={12} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.17 0.05 280)", border: "1px solid oklch(0.26 0.05 282)", borderRadius: 12 }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                  <Area type="monotone" dataKey="income" stroke="oklch(0.70 0.17 160)" fill="url(#grad-income)" strokeWidth={2} name="Receitas" />
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
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" innerRadius={55} outerRadius={90} paddingAngle={3}>
                      {byCategory.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "oklch(0.17 0.05 280)", border: "1px solid oklch(0.26 0.05 282)", borderRadius: 12 }}
                      formatter={(v: number) => formatCurrency(v)}
                    />
                  </PieChart>
                </ResponsiveContainer>
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card className="bg-gradient-card border-border/50 shadow-card">
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
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${t.categories?.color ?? "#4f46e5"}25`, color: t.categories?.color ?? "#4f46e5" }}
                  >
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

      <TransactionDialog open={openTx} onOpenChange={setOpenTx} />
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, gradient, accent,
}: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>;
  gradient?: boolean; accent?: "success" | "destructive";
}) {
  return (
    <Card className={`relative overflow-hidden border-border/50 shadow-card ${gradient ? "bg-gradient-primary text-primary-foreground" : "bg-gradient-card"}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className={`text-sm ${gradient ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{label}</p>
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
            gradient ? "bg-white/15" : accent === "success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
          }`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
        <p className="mt-3 font-display text-3xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
