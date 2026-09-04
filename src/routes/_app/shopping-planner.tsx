import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  ShoppingCart,
  CheckCircle2,
  CalendarClock,
  ExternalLink,
  Wallet,
  TrendingDown,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { ShoppingDialog } from "@/components/shopping-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useShoppingItems, type ShoppingItem } from "@/hooks/use-app-data";
import { useFinancialContext } from "@/hooks/use-financial-context";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency, toISODate } from "@/lib/format";
import {
  analisarViabilidadeCompra,
  compararFormasPagamento,
  calcularPrecoFinal,
} from "@/lib/shopping-analysis";
import {
  SHOPPING_STATUS,
  SHOPPING_PRIORITIES,
  priorityLabel,
  priorityColor,
  purchaseTypeLabel,
  purchaseTypeColor,
  shoppingPaymentLabel,
  shoppingStatusLabel,
  shoppingStatusColor,
} from "@/lib/shopping-constants";

export const Route = createFileRoute("/_app/shopping-planner")({
  component: ShoppingPlannerPage,
  head: () => ({
    meta: [
      { title: "Planejador de Compras — Furushima Financeiro" },
      {
        name: "description",
        content: "Planeje compras e veja se cabem no seu orçamento antes de gastar.",
      },
    ],
  }),
});

function ShoppingPlannerPage() {
  const { data: items = [], isLoading } = useShoppingItems();
  const ctx = useFinancialContext();
  const { isAdmin } = useRole();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const analisados = useMemo(
    () =>
      items.map((i) => ({
        item: i,
        analise: analisarViabilidadeCompra(
          {
            price: i.price,
            shipping: i.shipping,
            discount: i.discount,
            interest: i.interest,
            priority: i.priority,
            purchase_type: i.purchase_type,
            payment_method: i.payment_method,
            installments: i.installments,
            down_payment: i.down_payment,
            category_id: i.category_id,
            desired_date: i.desired_date,
          },
          ctx.contexto,
        ),
      })),
    [items, ctx.contexto],
  );

  const filtered = analisados.filter(({ item }) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (priorityFilter !== "all" && item.priority !== priorityFilter) return false;
    return true;
  });

  const pendentes = analisados.filter(
    ({ item }) => !["comprado", "cancelado"].includes(item.status),
  );
  const totalPlanejado = pendentes.reduce((s, { analise }) => s + analise.precoFinal, 0);
  const viaveis = pendentes.filter(({ analise }) => analise.faixa === "viavel").length;
  const arriscadas = pendentes.filter(
    ({ analise }) => analise.faixa === "risco" || analise.faixa === "inviavel",
  ).length;

  const remove = async (i: ShoppingItem) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!confirm(`Excluir "${i.item}" do planejador?`)) return;
    const { error } = await supabase.from("shopping_items").delete().eq("id", i.id);
    if (error) return toast.error(error.message);
    toast.success("Item removido");
    invalidateFinance(qc, "shopping");
  };

  const marcarComprado = async (i: ShoppingItem, precoFinal: number) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!user) return;
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        amount: precoFinal,
        type: "expense",
        flow: "real",
        description: i.item,
        occurred_at: toISODate(new Date()),
        account_id: i.account_id,
        category_id: i.category_id,
        payment_method: i.payment_method,
        notes: i.store ? `Compra em ${i.store}` : null,
      })
      .select("id")
      .single();
    if (txErr) return toast.error(txErr.message);
    const { error } = await supabase
      .from("shopping_items")
      .update({ status: "comprado", transaction_id: tx.id })
      .eq("id", i.id);
    if (error) return toast.error(error.message);
    toast.success("Compra registrada nas transações");
    invalidateFinance(qc, "shopping");
    invalidateFinance(qc, "transactions");
  };

  const adiar = async (i: ShoppingItem) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const { error } = await supabase
      .from("shopping_items")
      .update({ status: "adiado" })
      .eq("id", i.id);
    if (error) return toast.error(error.message);
    toast.success("Compra adiada");
    invalidateFinance(qc, "shopping");
  };

  return (
    <div className="p-3 sm:p-4 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">Decida antes de gastar</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">
            Planejador de Compras
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
            <Plus className="h-4 w-4 mr-2" /> Nova compra
          </Button>
        )}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard
          label="Saldo livre hoje"
          value={formatCurrency(ctx.contexto.saldoDisponivel - ctx.contexto.reservaMinima)}
          icon={Wallet}
          gradient
        />
        <StatCard
          label="Total planejado"
          value={formatCurrency(totalPlanejado)}
          icon={ShoppingCart}
        />
        <StatCard
          label="Compras viáveis"
          value={String(viaveis)}
          icon={CheckCircle2}
          accent="success"
        />
        <StatCard
          label="Compras arriscadas"
          value={String(arriscadas)}
          icon={TrendingDown}
          accent="destructive"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {SHOPPING_STATUS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as prioridades</SelectItem>
            {SHOPPING_PRIORITIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="py-14 text-center space-y-2">
            <ShoppingCart className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma compra planejada ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ item: i, analise }) => {
            const isOpen = expanded === i.id;
            const faixaColor =
              analise.faixa === "viavel"
                ? "#5FA498"
                : analise.faixa === "atencao"
                  ? "#fbbf24"
                  : analise.faixa === "risco"
                    ? "#f97316"
                    : "#f87171";
            const comparacao = compararFormasPagamento(
              {
                price: i.price,
                shipping: i.shipping,
                discount: i.discount,
                interest: i.interest,
                priority: i.priority,
                purchase_type: i.purchase_type,
                payment_method: i.payment_method,
                installments: i.installments,
                down_payment: i.down_payment,
              },
              ctx.contexto,
            );
            return (
              <Card key={i.id} className="bg-gradient-card border-border/50 shadow-card">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="font-display text-base sm:text-lg leading-tight flex items-center gap-2 flex-wrap">
                        {i.item}
                        {i.link && (
                          <a
                            href={i.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Abrir link de ${i.item}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{
                            borderColor: shoppingStatusColor(i.status),
                            color: shoppingStatusColor(i.status),
                          }}
                        >
                          {shoppingStatusLabel(i.status)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{
                            borderColor: priorityColor(i.priority),
                            color: priorityColor(i.priority),
                          }}
                        >
                          {priorityLabel(i.priority)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{
                            borderColor: purchaseTypeColor(i.purchase_type),
                            color: purchaseTypeColor(i.purchase_type),
                          }}
                        >
                          {purchaseTypeLabel(i.purchase_type)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {shoppingPaymentLabel(i.payment_method)}
                          {i.payment_method === "credito_parcelado" ? ` ${i.installments}x` : ""}
                          {i.store ? ` · ${i.store}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg font-bold">
                        {formatCurrency(calcularPrecoFinal(i))}
                      </p>
                      <p className="text-xs font-medium" style={{ color: faixaColor }}>
                        Score {analise.score}/100 · {analise.faixaLabel}
                      </p>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-secondary/60 overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${analise.score}%`, background: faixaColor }}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{analise.mensagem}</p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpanded(isOpen ? null : i.id)}
                    >
                      {isOpen ? "Ocultar análise" : "Ver análise completa"}
                    </Button>
                    {isAdmin && i.status !== "comprado" && (
                      <>
                        <Button size="sm" onClick={() => marcarComprado(i, analise.precoFinal)}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar como comprado
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => adiar(i)}>
                          <CalendarClock className="h-4 w-4 mr-1" /> Adiar
                        </Button>
                      </>
                    )}
                    {isAdmin && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditing(i);
                            setOpen(true);
                          }}
                          aria-label="Editar compra"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(i)}
                          aria-label="Excluir compra"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>

                  {isOpen && (
                    <div className="space-y-4 pt-2 border-t border-border/50">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">Impacto imediato</p>
                          <p className="font-medium">{formatCurrency(analise.impactoAtual)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Impacto mensal</p>
                          <p className="font-medium">{formatCurrency(analise.impactoMensal)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Saldo livre hoje</p>
                          <p className="font-medium">{formatCurrency(analise.saldoLivreAtual)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Saldo livre mensal</p>
                          <p className="font-medium">{formatCurrency(analise.saldoLivreMensal)}</p>
                        </div>
                      </div>

                      {analise.positivos.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-success mb-1">Pontos positivos</p>
                          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                            {analise.positivos.map((p, idx) => (
                              <li key={idx}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analise.negativos.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-destructive mb-1">
                            Pontos de atenção
                          </p>
                          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                            {analise.negativos.map((p, idx) => (
                              <li key={idx}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {analise.metasAfetadas.length > 0 && (
                        <div>
                          <p className="text-xs font-medium mb-1 flex items-center gap-1">
                            <Target className="h-3.5 w-3.5" /> Metas impactadas
                          </p>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {analise.metasAfetadas.map((m) => (
                              <li key={m.id}>
                                {m.name}: atraso estimado de {m.atrasoMeses} mês(es)
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {analise.plano && (
                        <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs space-y-1">
                          <p className="font-medium">Plano para comprar com segurança</p>
                          <p className="text-muted-foreground">
                            Faltam {formatCurrency(analise.plano.quantoFalta)}. Guardando{" "}
                            {formatCurrency(analise.plano.valorMensal)} por mês, em{" "}
                            {analise.plano.meses} mês(es) você compra com tranquilidade — a partir
                            de {new Date(analise.plano.dataSegura).toLocaleDateString("pt-BR")}.
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-medium mb-2">
                          Comparação de formas de pagamento
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {comparacao.map((c) => (
                            <div
                              key={c.metodo}
                              className="rounded-lg border border-border/60 p-2.5 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{c.label}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  risco {c.risco}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground">
                                Hoje: {formatCurrency(c.impactoImediato)} · Futuro:{" "}
                                {formatCurrency(c.impactoFuturo)}
                              </p>
                              <p className="text-success">{c.vantagem}</p>
                              <p className="text-muted-foreground">{c.desvantagem}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ShoppingDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
