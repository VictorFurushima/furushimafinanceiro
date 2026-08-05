import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useBudgets, useCategories, useTransactions } from "@/hooks/use-finance-data";
import { formatCurrency, firstOfMonth, toISODate } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/budgets")({
  component: BudgetsPage,
});

function BudgetsPage() {
  const monthDate = firstOfMonth();
  const monthStr = toISODate(monthDate);
  const { data: budgets = [] } = useBudgets(monthStr);
  const { data: categories = [] } = useCategories();
  const { data: transactions = [] } = useTransactions();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");

  const expenseCats = categories.filter((c) => c.type === "expense");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount.replace(",", "."));
    if (!categoryId || !val || val <= 0) return toast.error("Preencha corretamente");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("budgets").upsert(
      { category_id: categoryId, amount: val, month: monthStr, user_id: u.user.id },
      { onConflict: "user_id,category_id,month" },
    );
    if (error) return toast.error(error.message);
    toast.success("Orçamento salvo");
    qc.invalidateQueries({ queryKey: ["budgets"] });
    setOpen(false); setAmount(""); setCategoryId("");
  };

  const spentByCat = new Map<string, number>();
  transactions.forEach((t) => {
    if (t.type !== "expense" || !t.category_id) return;
    const d = new Date(t.occurred_at);
    if (d.getMonth() !== monthDate.getMonth() || d.getFullYear() !== monthDate.getFullYear()) return;
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + Number(t.amount));
  });

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Orçamentos</h1>
          <p className="text-sm text-muted-foreground mt-1 capitalize">
            {monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Plus className="h-4 w-4 mr-2" /> Definir
        </Button>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Acompanhamento</CardTitle></CardHeader>
        <CardContent>
          {budgets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhum orçamento ainda. Defina um limite para uma categoria.
            </p>
          ) : (
            <ul className="space-y-5">
              {budgets.map((b) => {
                const spent = spentByCat.get(b.category_id) ?? 0;
                const pct = Math.min(100, (spent / Number(b.amount)) * 100);
                const over = spent > Number(b.amount);
                return (
                  <li key={b.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.categories?.color ?? "#4f46e5" }} />
                        {b.categories?.name}
                      </span>
                      <span className={`text-sm ${over ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                        {formatCurrency(spent)} / {formatCurrency(Number(b.amount))}
                      </span>
                    </div>
                    <Progress value={pct} className={over ? "[&>div]:bg-destructive" : "[&>div]:bg-gradient-primary"} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader><DialogTitle className="font-display text-2xl">Novo orçamento</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {expenseCats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Limite (R$)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" required />
            </div>
            <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground shadow-glow">Salvar</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
