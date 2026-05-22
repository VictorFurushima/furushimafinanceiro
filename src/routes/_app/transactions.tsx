import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/use-finance-data";
import { TransactionDialog } from "@/components/transaction-dialog";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/transactions")({
  component: TransactionsPage,
});

function TransactionsPage() {
  const { data: transactions = [] } = useTransactions();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const remove = async (id: string) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluída");
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-bold">Transações</h1>
        <Button onClick={() => setOpen(true)} className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Plus className="h-4 w-4 mr-2" /> Nova
        </Button>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Todas as transações</CardTitle></CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Nada por aqui ainda.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center gap-4 py-3 group">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${t.categories?.color ?? "#4f46e5"}25`, color: t.categories?.color ?? "#4f46e5" }}>
                    {t.type === "income" ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.description || t.categories?.name || "Transação"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.categories?.name ?? "Sem categoria"} · {t.accounts?.name ?? "—"} · {new Date(t.occurred_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold ${t.type === "income" ? "text-success" : "text-destructive"}`}>
                    {t.type === "income" ? "+" : "−"} {formatCurrency(Number(t.amount))}
                  </span>
                  <button onClick={() => remove(t.id)} className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <TransactionDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
