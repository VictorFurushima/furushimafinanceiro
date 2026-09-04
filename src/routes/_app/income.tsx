import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, TrendingUp, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTransactionsPage } from "@/hooks/use-finance-data";
import { useMonthlySummary } from "@/hooks/use-finance-aggregates";
import { invalidateFinance } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import { TransactionDialog } from "@/components/transaction-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDateOnlyPtBR, toLocalDateString, todayISO, parseDateOnly } from "@/lib/date-only";

const iso = (d: Date) => toLocalDateString(d);
const PAGE_SIZE = 50;

export const Route = createFileRoute("/_app/income")({ component: IncomePage });

function IncomePage() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const qc = useQueryClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const { data: monthSummary } = useMonthlySummary(iso(monthStart), iso(monthEnd));
  const { data: allTime } = useMonthlySummary("1900-01-01", iso(monthEnd));
  const { data, isFetching } = useTransactionsPage({ type: "income", page, pageSize: PAGE_SIZE });

  const incomes = data?.rows ?? [];
  const totalCount = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const monthTotal = monthSummary?.receitas ?? 0;
  const totalAll = allTime?.receitas ?? 0;

  const remove = async (id: string) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidateFinance(qc, "transactions");
  };

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Receitas</h1>
          <p className="text-sm text-muted-foreground mt-1">Entradas de dinheiro</p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="bg-success text-success-foreground hover:bg-success/90"
        >
          <Plus className="h-4 w-4 mr-2" /> Nova receita
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Este mês</p>
            <p className="mt-2 font-display text-3xl font-bold text-success">
              {formatCurrency(monthTotal)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Total acumulado
            </p>
            <p className="mt-2 font-display text-3xl font-bold">{formatCurrency(totalAll)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {incomes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhuma receita registrada.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {incomes.map((t) => (
                <li key={t.id} className="flex items-center gap-4 py-3 group">
                  <div className="h-10 w-10 rounded-xl bg-success/15 text-success flex items-center justify-center shrink-0">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {t.description || t.categories?.name || "Receita"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.categories?.name ?? "—"} ·{" "}
                      {formatDateOnlyPtBR(t.occurred_at)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-success">
                    + {formatCurrency(Number(t.amount))}
                  </span>
                  <button
                    type="button"
                    aria-label="Excluir receita"
                    onClick={() => remove(t.id)}
                    className="p-2 -m-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 text-muted-foreground hover:text-destructive"
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

      <TransactionDialog open={open} onOpenChange={setOpen} defaultType="income" />
    </div>
  );
}
