import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Download, X, ArrowLeftRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTransactionsPage, useCategories } from "@/hooks/use-finance-data";
import { invalidateFinance, type TransactionFilters } from "@/lib/query-keys";
import { TransactionDialog } from "@/components/transaction-dialog";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS, paymentLabel } from "@/lib/finance-constants";
import { supabase } from "@/integrations/supabase/client";
import { formatDateOnlyPtBR, toLocalDateString, todayISO, parseDateOnly } from "@/lib/date-only";

const PAGE_SIZE = 50;

export const Route = createFileRoute("/_app/transactions")({ component: TransactionsPage });

function TransactionsPage() {
  const { data: categories = [] } = useCategories();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [fType, setFType] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [fCat, setFCat] = useState<string>("all");
  const [fPay, setFPay] = useState<string>("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fMin, setFMin] = useState("");
  const [fMax, setFMax] = useState("");

  const filters: TransactionFilters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      type: fType,
      categoryId: fCat,
      paymentMethod: fPay,
      from: fFrom || undefined,
      to: fTo || undefined,
      min: fMin || undefined,
      max: fMax || undefined,
      search: search || undefined,
    }),
    [page, search, fType, fCat, fPay, fFrom, fTo, fMin, fMax],
  );

  const { data, isFetching } = useTransactionsPage(filters);
  const rows = data?.rows ?? [];
  const totalCount = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const onFilterChange =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setPage(0);
      setter(v);
    };

  const clearFilters = () => {
    setPage(0);
    setSearch("");
    setFType("all");
    setFCat("all");
    setFPay("all");
    setFFrom("");
    setFTo("");
    setFMin("");
    setFMax("");
  };

  const remove = async (id: string) => {
    if (
      !confirm(
        "Excluir este lançamento? Pagamentos excluídos reabrem a fatura e devolvem o valor à conta.",
      )
    )
      return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Excluída");
    invalidateFinance(qc, "transactions");
  };

  const exportCSV = async () => {
    let q = supabase
      .from("transactions")
      .select(
        "occurred_at, type, flow, amount, description, payment_method, categories(name), accounts!transactions_account_id_fkey(name)",
      )
      .order("occurred_at", { ascending: false })
      .limit(5000);
    if (fType !== "all") q = q.eq("type", fType);
    if (fCat !== "all") q = q.eq("category_id", fCat);
    if (fPay !== "all") q = q.eq("payment_method", fPay);
    if (fFrom) q = q.gte("occurred_at", fFrom);
    if (fTo) q = q.lte("occurred_at", fTo);
    if (fMin) q = q.gte("amount", Number(fMin));
    if (fMax) q = q.lte("amount", Number(fMax));
    if (search) q = q.ilike("description", `%${search}%`);

    const { data: all, error } = await q;
    if (error) return toast.error(friendlyError(error));

    const header = [
      "Data",
      "Tipo",
      "Valor",
      "Categoria",
      "Descrição",
      "Forma de Pagamento",
      "Conta",
    ];
    const csvRows = (all ?? []).map((t) => [
      t.occurred_at,
      t.flow === "bill_payment"
        ? "Pagamento de fatura"
        : t.type === "transfer"
          ? "Transferência"
          : t.type === "income"
            ? "Receita"
            : "Despesa",
      String(t.amount).replace(".", ","),
      t.categories?.name ?? "",
      (t.description ?? "").replace(/"/g, '""'),
      paymentLabel(t.payment_method),
      t.accounts?.name ?? "",
    ]);
    const csv = [header, ...csvRows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacoes-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado");
  };

  // Transferência apenas move dinheiro entre contas: não entra no total do período.
  const pageTotal = rows.reduce(
    (s, t) =>
      t.type === "transfer" || (t.flow && t.flow !== "real")
        ? s
        : s + (t.type === "income" ? Number(t.amount) : -Number(t.amount)),
    0,
  );

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Transações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount} no filtro · Resultado de receitas e despesas desta página:{" "}
            <span className={pageTotal >= 0 ? "text-success" : "text-destructive"}>
              {formatCurrency(pageTotal)}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button
            onClick={() => setOpen(true)}
            className="bg-gradient-primary text-primary-foreground shadow-glow"
          >
            <Plus className="h-4 w-4 mr-2" /> Nova
          </Button>
        </div>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => onFilterChange(setSearch)(e.target.value)}
            />
            <Select
              value={fType}
              onValueChange={(v) => onFilterChange(setFType)(v as typeof fType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="income">Receitas</SelectItem>
                <SelectItem value="expense">Despesas</SelectItem>
                <SelectItem value="transfer">Transferências</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fCat} onValueChange={onFilterChange(setFCat)}>
              <SelectTrigger>
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fPay} onValueChange={onFilterChange(setFPay)}>
              <SelectTrigger>
                <SelectValue placeholder="Forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas formas</SelectItem>
                {PAYMENT_METHODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input
              type="date"
              value={fFrom}
              onChange={(e) => onFilterChange(setFFrom)(e.target.value)}
              placeholder="De"
            />
            <Input
              type="date"
              value={fTo}
              onChange={(e) => onFilterChange(setFTo)(e.target.value)}
              placeholder="Até"
            />
            <Input
              type="number"
              placeholder="Valor mín"
              value={fMin}
              onChange={(e) => onFilterChange(setFMin)(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Valor máx"
              value={fMax}
              onChange={(e) => onFilterChange(setFMax)(e.target.value)}
            />
            <Button variant="outline" onClick={clearFilters}>
              <X className="h-4 w-4 mr-2" />
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhuma transação encontrada.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {rows.map((t) => (
                <li key={t.id} className="flex items-center gap-4 py-3 group">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: `${t.categories?.color ?? "#22d3ee"}25`,
                      color: t.categories?.color ?? "#22d3ee",
                    }}
                  >
                    {t.type === "transfer" ? (
                      <ArrowLeftRight className="h-5 w-5" />
                    ) : t.type === "income" ? (
                      <TrendingUp className="h-5 w-5" />
                    ) : (
                      <TrendingDown className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {t.description || t.categories?.name || "Transação"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.flow === "bill_payment"
                        ? "Pagamento de fatura"
                        : t.type === "transfer"
                          ? "Transferência"
                          : (t.categories?.name ?? "Sem categoria")}
                      {t.subcategory && ` · ${t.subcategory}`}
                      {" · "}
                      {paymentLabel(t.payment_method)} · {formatDateOnlyPtBR(t.occurred_at)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold ${t.type === "transfer" ? "text-muted-foreground" : t.type === "income" ? "text-success" : "text-destructive"}`}
                  >
                    {t.type === "transfer" ? "↔" : t.type === "income" ? "+" : "−"}{" "}
                    {formatCurrency(Number(t.amount))}
                  </span>
                  <button
                    type="button"
                    aria-label="Excluir transação"
                    onClick={() => remove(t.id)}
                    className="p-2 -m-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-border/50">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {page + 1} de {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <TransactionDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
