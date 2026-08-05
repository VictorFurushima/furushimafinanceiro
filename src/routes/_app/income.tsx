import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, TrendingUp, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { TransactionDialog } from "@/components/transaction-dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/income")({ component: IncomePage });

function IncomePage() {
  const { data: transactions = [] } = useTransactions();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const incomes = transactions.filter((t) => t.type === "income");

  const now = new Date();
  const monthIncomes = incomes.filter((t) => {
    const d = new Date(t.occurred_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthTotal = monthIncomes.reduce((s, t) => s + Number(t.amount), 0);
  const totalAll = incomes.reduce((s, t) => s + Number(t.amount), 0);

  const remove = async (id: string) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Receitas</h1>
          <p className="text-sm text-muted-foreground mt-1">Entradas de dinheiro</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-success text-success-foreground hover:bg-success/90">
          <Plus className="h-4 w-4 mr-2" /> Nova receita
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Este mês</p>
            <p className="mt-2 font-display text-3xl font-bold text-success">{formatCurrency(monthTotal)}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total acumulado</p>
            <p className="mt-2 font-display text-3xl font-bold">{formatCurrency(totalAll)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Histórico</CardTitle></CardHeader>
        <CardContent>
          {incomes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Nenhuma receita registrada.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {incomes.map((t) => (
                <li key={t.id} className="flex items-center gap-4 py-3 group">
                  <div className="h-10 w-10 rounded-xl bg-success/15 text-success flex items-center justify-center shrink-0">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.description || t.categories?.name || "Receita"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.categories?.name ?? "—"} · {new Date(t.occurred_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-success">+ {formatCurrency(Number(t.amount))}</span>
                  <button type="button" aria-label="Excluir receita" onClick={() => remove(t.id)} className="p-2 -m-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <TransactionDialog open={open} onOpenChange={setOpen} defaultType="income" />
    </div>
  );
}
