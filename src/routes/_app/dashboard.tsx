import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight, Plus,
  PiggyBank, Percent, Crown, Calendar, Repeat, Inbox, CreditCard as CardIcon,
  AlertCircle, Sparkles, FileText,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useAccounts, useCategories, useRecurring, useTransactions,
  useRecharges, useCreditCards, useCreditCardBills,
} from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { TransactionDialog } from "@/components/transaction-dialog";
import { StatCard } from "@/components/stat-card";

export const Route = createFileRoute("/_app/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const { data: transactions = [] } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: recurring = [] } = useRecurring();
  const { data: recharges = [] } = useRecharges();
  const { data: cards = [] } = useCreditCards();
  const { data: bills = [] } = useCreditCardBills();
  const [openTx, setOpenTx] = useState(false);

  const now = new Date();
  const today = new Date(now.toDateString());

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

  // ---- RECHARGES ----
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthRecharges = recharges.filter((r) => {
    const d = new Date(r.expected_date);
    return d >= monthStart && d <= monthEnd && r.status !== "cancelada";
  });
  const totalPrevisto = monthRecharges
    .filter((r) => r.status === "prevista" || r.status === "confirmada")
    .filter((r) => r.recharge_type !== "bill_payment" && r.recharge_type !== "limit_release")
    .reduce((s, r) => s + r.expected_amount, 0);
  const totalConfirmado = monthRecharges
    .filter((r) => r.status === "confirmada" || r.status === "recebida")
    .filter((r) => r.recharge_type !== "bill_payment" && r.recharge_type !== "limit_release")
    .reduce((s, r) => s + r.expected_amount, 0);

  const nextRecharge = useMemo(() => {
    return recharges
      .filter((r) => r.status === "prevista" || r.status === "confirmada")
      .filter((r) => new Date(r.expected_date) >= today)
      .sort((a, b) => a.expected_date.localeCompare(b.expected_date))[0];
  }, [recharges]);

  const daysToRecharge = nextRecharge
    ? Math.ceil((new Date(nextRecharge.expected_date).getTime() - today.getTime()) / 86400000)
    : null;

  const overdueRecharges = recharges.filter((r) => r.status === "atrasada");
  const upcomingRecharges = recharges
    .filter((r) => r.status === "prevista" || r.status === "confirmada")
    .filter((r) => {
      const d = new Date(r.expected_date);
      return d >= today && (d.getTime() - today.getTime()) / 86400000 <= 3;
    });

  // Saldo previsto fim do mês = saldo atual + previstas restantes - recorrentes futuras
  const remainingRecharges = monthRecharges
    .filter((r) => r.status === "prevista" || r.status === "confirmada")
    .filter((r) => r.recharge_type !== "bill_payment" && r.recharge_type !== "limit_release")
    .reduce((s, r) => s + r.expected_amount, 0);
  const remainingSubs = recurring
    .filter((r) => r.status === "active" && r.frequency === "monthly")
    .filter((r) => r.billing_day >= now.getDate())
    .reduce((s, r) => s + Number(r.amount), 0);
  const saldoPrevisto = balance + remainingRecharges - remainingSubs;

  // ---- CARDS / BILLS ----
  const openBills = bills.filter((b) => b.status !== "paga");
  const upcomingBills = openBills
    .map((b) => ({ ...b, days: Math.ceil((new Date(b.due_date).getTime() - today.getTime()) / 86400000) }))
    .filter((b) => b.days <= 5)
    .sort((a, b) => a.days - b.days);
  const lowLimitCards = cards.filter((c) => {
    const avail = c.total_limit - c.used_limit;
    return c.total_limit > 0 && avail / c.total_limit < 0.2;
  });

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

  const alerts: { msg: string; tone: "destructive" | "warning" }[] = [];
  if (overdueRecharges.length > 0)
    alerts.push({ msg: `${overdueRecharges.length} recarga(s) atrasada(s)`, tone: "destructive" });
  if (upcomingBills.length > 0)
    alerts.push({ msg: `${upcomingBills.length} fatura(s) vencendo em até 5 dias`, tone: "warning" });
  if (lowLimitCards.length > 0)
    alerts.push({ msg: `Limite abaixo de 20% em ${lowLimitCards.length} cartão(ões)`, tone: "warning" });
  if (saldoPrevisto < 0)
    alerts.push({ msg: "Saldo previsto para o fim do mês está negativo", tone: "destructive" });
  if (upcomingRecharges.length > 0)
    alerts.push({ msg: `${upcomingRecharges.length} recarga(s) nos próximos 3 dias`, tone: "warning" });

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-3 sm:gap-4">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground capitalize">
            {now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Visão Geral</h1>
        </div>
        <Button onClick={() => setOpenTx(true)} className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90 w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" /> Nova transação
        </Button>
      </header>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <Alert key={i} className={a.tone === "destructive" ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10"}>
              <AlertCircle className={`h-4 w-4 ${a.tone === "destructive" ? "text-destructive" : "text-warning"}`} />
              <AlertDescription className="text-xs sm:text-sm">{a.msg}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard label="Saldo real" value={formatCurrency(balance)} icon={Wallet} gradient />
        <StatCard label="Saldo previsto" value={formatCurrency(saldoPrevisto)} icon={Sparkles}
          accent={saldoPrevisto >= 0 ? "success" : "destructive"} hint="fim do mês" />
        <StatCard label="Receitas do mês" value={formatCurrency(income)} icon={ArrowUpRight} accent="success" />
        <StatCard label="Despesas do mês" value={formatCurrency(expense)} icon={ArrowDownRight} accent="destructive"
          hint={lastExpense > 0 ? `${deltaVsLast > 0 ? "+" : ""}${deltaVsLast.toFixed(0)}% vs mês passado` : undefined} />
        <StatCard label="Economia" value={formatCurrency(economy)} icon={PiggyBank} accent={economy >= 0 ? "success" : "destructive"} />
        <StatCard label="% renda gasta" value={`${pctSpent.toFixed(0)}%`} icon={Percent}
          accent={pctSpent > 80 ? "destructive" : pctSpent > 50 ? "warning" : "success"} />
        <StatCard label="Previsto no mês" value={formatCurrency(totalPrevisto)} icon={Inbox} accent="success"
          hint={`${formatCurrency(totalConfirmado)} confirmado`} />
        <StatCard label="Maior categoria" value={topCategory?.name ?? "—"} icon={Crown}
          hint={topCategory ? formatCurrency(topCategory.value) : undefined} />
      </div>

      {/* Próxima recarga + Cartões + Faturas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-gradient-card border-border/50 shadow-card lg:col-span-1">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" /> Próxima recarga
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextRecharge ? (
              <div className="space-y-2">
                <p className="font-display text-2xl font-bold">{nextRecharge.name}</p>
                <p className="text-3xl font-bold text-success">{formatCurrency(nextRecharge.expected_amount)}</p>
                <p className="text-sm text-muted-foreground">
                  {daysToRecharge === 0 ? "Hoje" : daysToRecharge === 1 ? "Amanhã" : `Em ${daysToRecharge} dias`}
                  {" · "}{new Date(nextRecharge.expected_date).toLocaleDateString("pt-BR")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma recarga prevista. Cadastre na página Recargas.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <CardIcon className="h-5 w-5 text-primary" /> Limite dos cartões
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cards.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhum cartão cadastrado.</p>
            ) : (
              <ul className="space-y-3">
                {cards.slice(0, 3).map((c) => {
                  const avail = c.total_limit - c.used_limit;
                  const usedPct = c.total_limit > 0 ? (c.used_limit / c.total_limit) * 100 : 0;
                  return (
                    <li key={c.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-success">{formatCurrency(avail)}</span>
                      </div>
                      <Progress value={usedPct} className="h-1.5" />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Faturas próximas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingBills.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma fatura próxima do vencimento.</p>
            ) : (
              <ul className="space-y-2">
                {upcomingBills.slice(0, 4).map((b) => {
                  const card = cards.find((c) => c.id === b.card_id);
                  return (
                    <li key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/40">
                      <div>
                        <p className="text-sm font-medium">{card?.name ?? "Cartão"}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.days <= 0 ? "Vencida" : `Vence em ${b.days}d`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-destructive">{formatCurrency(b.amount)}</p>
                        {b.days <= 0 && <Badge variant="destructive" className="text-[10px]">Atrasada</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display">Evolução — últimos 6 meses</CardTitle></CardHeader>
          <CardContent>
            <div className="h-56 sm:h-72 -mx-2 sm:mx-0">
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
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Repeat className="h-5 w-5" /> Próximas assinaturas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const subs = recurring
                .filter((r) => r.status === "active" && r.frequency === "monthly")
                .map((r) => {
                  const next = new Date(now.getFullYear(), now.getMonth(), r.billing_day);
                  if (next < now) next.setMonth(next.getMonth() + 1);
                  return { ...r, next, days: Math.ceil((next.getTime() - now.getTime()) / 86400000) };
                })
                .sort((a, b) => a.days - b.days)
                .slice(0, 4);
              if (subs.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma assinatura ativa.</p>;
              return (
                <ul className="space-y-2">
                  {subs.map((s) => (
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
              );
            })()}
            <Calendar className="hidden" />
          </CardContent>
        </Card>
      </div>

      <TransactionDialog open={openTx} onOpenChange={setOpenTx} />
    </div>
  );
}
