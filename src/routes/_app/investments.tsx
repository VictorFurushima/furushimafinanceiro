import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Wallet,
  Percent,
  ShieldCheck,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Calculator,
  BellRing,
} from "lucide-react";
import { toast } from "sonner";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { InvestmentDialog } from "@/components/investment-dialog";
import { InvestmentMoveDialog, type MoveKind } from "@/components/investment-move-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import {
  useInvestments,
  useInvestmentEvents,
  useUserSettings,
  type Investment,
} from "@/hooks/use-app-data";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { useSelic, formatSelicTimestamp } from "@/hooks/use-selic";
import { formatCurrency } from "@/lib/format";
import {
  INVESTMENT_TYPES,
  investmentTypeLabel,
  investmentTypeColor,
  riskLabel,
  riskColor,
  liquidityLabel,
  investmentStatusLabel,
  investmentStatusColor,
  INVESTMENT_EVENT_LABELS,
} from "@/lib/investment-constants";

export const Route = createFileRoute("/_app/investments")({
  component: InvestmentsPage,
  head: () => ({
    meta: [
      { title: "Investimentos — Furushima Financeiro" },
      {
        name: "description",
        content: "Acompanhe aportes, resgates, rendimento e composição da sua carteira.",
      },
    ],
  }),
});

const parseNum = (v: string) => parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0;

function InvestmentsPage() {
  const { data: investments = [], isLoading } = useInvestments();
  const { data: events = [] } = useInvestmentEvents();
  const { data: settings } = useUserSettings();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const selic = useSelic();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Investment | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveKind, setMoveKind] = useState<MoveKind>("aporte");
  const [moveTarget, setMoveTarget] = useState<Investment | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [reminderVisible, setReminderVisible] = useState(false);

  const ativos = investments.filter((i) => i.status !== "resgatado");
  const totalInvestido = ativos.reduce((s, i) => s + i.invested_amount, 0);
  const valorAtual = ativos.reduce((s, i) => s + i.current_amount, 0);
  const rendimento = valorAtual - totalInvestido;
  const rentabilidade = totalInvestido > 0 ? (rendimento / totalInvestido) * 100 : 0;
  const reserva = ativos
    .filter((i) => i.is_emergency_reserve)
    .reduce((s, i) => s + i.current_amount, 0);

  const rendPorInv = ativos.map((i) => ({ ...i, rend: i.current_amount - i.invested_amount }));
  const maior = [...rendPorInv].sort((a, b) => b.rend - a.rend)[0];
  const menor = [...rendPorInv].sort((a, b) => a.rend - b.rend)[0];

  const rendimentoMensalEstimado = useMemo(() => {
    // rendimento acumulado dividido pelos meses médios de aplicação
    const now = Date.now();
    let total = 0;
    for (const i of ativos) {
      const meses = Math.max(1, (now - new Date(i.applied_at).getTime()) / (30 * 86400000));
      total += (i.current_amount - i.invested_amount) / meses;
    }
    return total;
  }, [ativos]);

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    ativos.forEach((i) => map.set(i.inv_type, (map.get(i.inv_type) ?? 0) + i.current_amount));
    return Array.from(map.entries())
      .map(([k, v]) => ({ name: investmentTypeLabel(k), value: v, color: investmentTypeColor(k) }))
      .sort((a, b) => b.value - a.value);
  }, [ativos]);

  const evolucao = useMemo(() => {
    const months: {
      label: string;
      key: string;
      aporte: number;
      resgate: number;
      rendimento: number;
      acumulado: number;
    }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        aporte: 0,
        resgate: 0,
        rendimento: 0,
        acumulado: 0,
      });
    }
    events.forEach((e) => {
      const d = new Date(e.occurred_at);
      const m = months.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (!m) return;
      if (e.event_type === "aporte") m.aporte += e.amount;
      else if (e.event_type === "resgate") m.resgate += e.amount;
      else if (e.event_type === "rendimento") m.rendimento += e.amount;
    });
    let acc = 0;
    months.forEach((m) => {
      acc += m.aporte - m.resgate + m.rendimento;
      m.acumulado = acc;
    });
    return months;
  }, [events]);

  const investidoVsAtual = ativos.slice(0, 8).map((i) => ({
    name: i.name.slice(0, 14),
    investido: i.invested_amount,
    atual: i.current_amount,
  }));

  const participacao = ativos
    .map((i) => ({ name: i.name, value: i.current_amount, color: investmentTypeColor(i.inv_type) }))
    .sort((a, b) => b.value - a.value);

  const filtered =
    typeFilter === "all" ? investments : investments.filter((i) => i.inv_type === typeFilter);

  // ---- Lembrete mensal de aporte ----
  useEffect(() => {
    if (!settings?.reminder_enabled || !isAdmin) return;
    const today = new Date();
    const key = `furushima:reminder:${today.toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    if (today.getDate() < settings.reminder_day) return;
    setReminderVisible(true);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Furushima Financeiro", {
        body:
          settings.reminder_message ||
          `Hora do seu aporte mensal de ${formatCurrency(settings.reminder_amount)}.`,
      });
    }
  }, [settings, isAdmin]);

  const dismissReminder = (permanent: boolean) => {
    const key = `furushima:reminder:${new Date().toISOString().slice(0, 10)}`;
    if (permanent) localStorage.setItem(key, "1");
    setReminderVisible(false);
  };

  const remove = async (inv: Investment) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!confirm(`Excluir "${inv.name}"? O histórico também será removido.`)) return;
    const { error } = await supabase.from("investments").delete().eq("id", inv.id);
    if (error) return toast.error(error.message);
    toast.success("Investimento excluído");
    invalidateFinance(qc, "investments");
  };

  const openMove = (inv: Investment, kind: MoveKind) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    setMoveTarget(inv);
    setMoveKind(kind);
    setMoveOpen(true);
  };

  const reminderInvestment = investments.find((i) => i.id === settings?.reminder_investment_id);

  return (
    <div className="p-3 sm:p-4 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Carteira, rendimento e projeções
          </p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">
            Investimentos
          </h1>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="bg-gradient-primary text-primary-foreground shadow-glow w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" /> Novo investimento
          </Button>
        )}
      </header>

      {reminderVisible && (
        <Alert className="border-primary/50 bg-primary/10">
          <BellRing className="h-4 w-4 text-primary" />
          <AlertDescription className="text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="flex-1">
              {settings?.reminder_message || "Lembrete de aporte mensal"}
              {settings?.reminder_amount
                ? ` · sugerido ${formatCurrency(settings.reminder_amount)}`
                : ""}
              {reminderInvestment ? ` · ${reminderInvestment.name}` : ""}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (reminderInvestment) openMove(reminderInvestment, "aporte");
                  dismissReminder(true);
                }}
              >
                Registrar aporte agora
              </Button>
              <Button size="sm" variant="outline" onClick={() => dismissReminder(false)}>
                Lembrar depois
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismissReminder(true)}>
                Marcar como feito
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard
          label="Total investido"
          value={formatCurrency(totalInvestido)}
          icon={Wallet}
          gradient
        />
        <StatCard
          label="Valor atual"
          value={formatCurrency(valorAtual)}
          icon={PiggyBank}
          accent="success"
        />
        <StatCard
          label="Rendimento total"
          value={formatCurrency(rendimento)}
          icon={TrendingUp}
          accent={rendimento >= 0 ? "success" : "destructive"}
        />
        <StatCard
          label="Rentabilidade"
          value={`${rentabilidade.toFixed(2)}%`}
          icon={Percent}
          accent={rentabilidade >= 0 ? "success" : "destructive"}
        />
        <StatCard
          label="Rendimento mensal est."
          value={formatCurrency(rendimentoMensalEstimado)}
          icon={TrendingUp}
        />
        <StatCard
          label="Maior rendimento"
          value={maior ? maior.name : "—"}
          icon={TrendingUp}
          hint={maior ? formatCurrency(maior.rend) : undefined}
          accent="success"
        />
        <StatCard
          label="Menor rendimento"
          value={menor ? menor.name : "—"}
          icon={TrendingDown}
          hint={menor ? formatCurrency(menor.rend) : undefined}
          accent="destructive"
        />
        <StatCard
          label="Reserva de emergência"
          value={formatCurrency(reserva)}
          icon={ShieldCheck}
        />
      </div>

      <SelicCard selic={selic} />

      {byType.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <Card className="bg-gradient-card border-border/50 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base sm:text-lg">
                Distribuição por tipo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={byType}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {byType.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="bg-gradient-card border-border/50 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base sm:text-lg">
                Evolução do patrimônio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={evolucao}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={50} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Area
                    type="monotone"
                    dataKey="acumulado"
                    stroke="#228E9A"
                    fill="#228E9A"
                    fillOpacity={0.25}
                    name="Acumulado"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="bg-gradient-card border-border/50 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base sm:text-lg">
                Aportes e rendimento por mês
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={evolucao}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={50} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="aporte" fill="#228E9A" name="Aportes" radius={[4, 4, 0, 0]} />
                  <Bar
                    dataKey="rendimento"
                    fill="#5FA498"
                    name="Rendimento"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar dataKey="resgate" fill="#f87171" name="Resgates" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="bg-gradient-card border-border/50 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base sm:text-lg">Investido x Atual</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={investidoVsAtual}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={50} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="investido" fill="#20656C" name="Investido" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="atual" fill="#5FA498" name="Atual" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <Simulator selicRate={selic.rate} />

      <div className="flex flex-wrap gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {INVESTMENT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display text-base sm:text-lg">Seus investimentos</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhum investimento cadastrado ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {filtered.map((i) => {
                const rend = i.current_amount - i.invested_amount;
                const pct = i.invested_amount > 0 ? (rend / i.invested_amount) * 100 : 0;
                const share = valorAtual > 0 ? (i.current_amount / valorAtual) * 100 : 0;
                return (
                  <li key={i.id} className="py-3 flex flex-wrap items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: `${investmentTypeColor(i.inv_type)}25`,
                        color: investmentTypeColor(i.inv_type),
                      }}
                    >
                      <PiggyBank className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{i.name}</p>
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{
                            borderColor: investmentStatusColor(i.status),
                            color: investmentStatusColor(i.status),
                          }}
                        >
                          {investmentStatusLabel(i.status)}
                        </Badge>
                        {i.is_emergency_reserve && (
                          <Badge variant="outline" className="text-[10px]">
                            Reserva
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {investmentTypeLabel(i.inv_type)}
                        {i.institution ? ` · ${i.institution}` : ""} · {liquidityLabel(i.liquidity)}{" "}
                        ·{" "}
                        <span style={{ color: riskColor(i.risk) }}>
                          risco {riskLabel(i.risk).toLowerCase()}
                        </span>{" "}
                        · {share.toFixed(1)}% da carteira
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(i.current_amount)}</p>
                      <p className={`text-xs ${rend >= 0 ? "text-success" : "text-destructive"}`}>
                        {rend >= 0 ? "+" : ""}
                        {formatCurrency(rend)} ({pct.toFixed(2)}%)
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openMove(i, "aporte")}
                          aria-label="Registrar aporte"
                          title="Aporte"
                        >
                          <ArrowDownToLine className="h-4 w-4 text-success" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openMove(i, "resgate")}
                          aria-label="Registrar resgate"
                          title="Resgate"
                        >
                          <ArrowUpFromLine className="h-4 w-4 text-warning" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openMove(i, "valor")}
                          aria-label="Atualizar valor"
                          title="Atualizar valor"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditing(i);
                            setOpen(true);
                          }}
                          aria-label="Editar investimento"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(i)}
                          aria-label="Excluir investimento"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {participacao.length > 0 && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base sm:text-lg">
              Participação por investimento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {participacao.map((p) => {
              const pct = valorAtual > 0 ? (p.value / valorAtual) * 100 : 0;
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted-foreground">
                      {pct.toFixed(1)}% · {formatCurrency(p.value)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: p.color }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display text-base sm:text-lg">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhuma movimentação registrada.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {events.slice(0, 30).map((e) => {
                const inv = investments.find((i) => i.id === e.investment_id);
                return (
                  <li key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">
                        {INVESTMENT_EVENT_LABELS[e.event_type] ?? e.event_type} · {inv?.name ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.occurred_at).toLocaleDateString("pt-BR")}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </p>
                    </div>
                    <span
                      className={e.event_type === "resgate" ? "text-destructive" : "text-success"}
                    >
                      {e.event_type === "resgate" ? "-" : "+"}
                      {formatCurrency(Math.abs(e.amount))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <InvestmentDialog open={open} onOpenChange={setOpen} editing={editing} />
      <InvestmentMoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        investment={moveTarget}
        kind={moveKind}
      />
    </div>
  );
}

function SelicCard({ selic }: { selic: ReturnType<typeof useSelic> }) {
  return (
    <Card className="bg-gradient-card border-border/50 shadow-card">
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Taxa Selic (Banco Central)</p>
          <p className="font-display text-2xl font-bold">
            {selic.rate !== null
              ? `${selic.rate.toFixed(2)}% a.a.`
              : selic.loading
                ? "Carregando..."
                : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Atualizado em {formatSelicTimestamp(selic.fetchedAt)}
          </p>
          {selic.stale && (
            <p className="text-[11px] text-warning mt-1">
              Não foi possível atualizar agora. Usando o último valor salvo.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void selic.refresh(true)}>
          <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
        </Button>
      </CardContent>
    </Card>
  );
}

function Simulator({ selicRate }: { selicRate: number | null }) {
  const [initial, setInitial] = useState("1000");
  const [monthly, setMonthly] = useState("300");
  const [months, setMonths] = useState("24");
  const [useSelicRate, setUseSelicRate] = useState(true);
  const [customRate, setCustomRate] = useState("12");

  const annual = useSelicRate && selicRate !== null ? selicRate : parseNum(customRate);
  const monthlyRate = Math.pow(1 + annual / 100, 1 / 12) - 1;

  const serie = useMemo(() => {
    const n = Math.max(1, Math.min(600, Math.round(parseNum(months))));
    const p0 = parseNum(initial);
    const pm = parseNum(monthly);
    const rows: { mes: string; valor: number; aportado: number }[] = [];
    let saldo = p0;
    let aportado = p0;
    for (let m = 1; m <= n; m++) {
      saldo = saldo * (1 + monthlyRate) + pm;
      aportado += pm;
      rows.push({
        mes: `${m}`,
        valor: Math.round(saldo * 100) / 100,
        aportado: Math.round(aportado * 100) / 100,
      });
    }
    return rows;
  }, [initial, monthly, months, monthlyRate]);

  const last = serie[serie.length - 1];
  const rendimentoTotal = last ? last.valor - last.aportado : 0;
  const rendMedio = serie.length > 0 ? rendimentoTotal / serie.length : 0;

  return (
    <Card className="bg-gradient-card border-border/50 shadow-card">
      <CardHeader>
        <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
          <Calculator className="h-4 w-4" /> Simulador de investimento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-2">
            <Label htmlFor="sim-initial">Valor inicial</Label>
            <Input
              id="sim-initial"
              value={initial}
              onChange={(e) => setInitial(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-monthly">Aporte mensal</Label>
            <Input
              id="sim-monthly"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-months">Meses</Label>
            <Input
              id="sim-months"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label>Taxa</Label>
            <Select
              value={useSelicRate ? "selic" : "custom"}
              onValueChange={(v) => setUseSelicRate(v === "selic")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selic">Selic atual</SelectItem>
                <SelectItem value="custom">Personalizada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-rate">Taxa anual (%)</Label>
            <Input
              id="sim-rate"
              value={useSelicRate && selicRate !== null ? selicRate.toFixed(2) : customRate}
              onChange={(e) => setCustomRate(e.target.value)}
              disabled={useSelicRate && selicRate !== null}
              inputMode="decimal"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <StatCard
            label="Valor final"
            value={formatCurrency(last?.valor ?? 0)}
            icon={PiggyBank}
            gradient
          />
          <StatCard
            label="Total aportado"
            value={formatCurrency(last?.aportado ?? 0)}
            icon={Wallet}
          />
          <StatCard
            label="Rendimento"
            value={formatCurrency(rendimentoTotal)}
            icon={TrendingUp}
            accent="success"
          />
          <StatCard
            label="Rendimento médio/mês"
            value={formatCurrency(rendMedio)}
            icon={Percent}
            accent="success"
          />
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={serie}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="mes" fontSize={10} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={50} />
            <Tooltip
              formatter={(v: number) => formatCurrency(v)}
              labelFormatter={(l) => `Mês ${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="aportado"
              stroke="#20656C"
              fill="#20656C"
              fillOpacity={0.2}
              name="Aportado"
            />
            <Area
              type="monotone"
              dataKey="valor"
              stroke="#5FA498"
              fill="#5FA498"
              fillOpacity={0.25}
              name="Com rendimento"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
