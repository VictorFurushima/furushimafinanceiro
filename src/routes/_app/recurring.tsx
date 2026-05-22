import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Pause, Play, Repeat } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRecurring, type RecurringExpense } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { paymentLabel, FREQUENCIES } from "@/lib/finance-constants";
import { RecurringDialog } from "@/components/recurring-dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/recurring")({ component: RecurringPage });

function RecurringPage() {
  const { data: items = [] } = useRecurring();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const qc = useQueryClient();

  const today = new Date();
  const active = items.filter((i) => i.status === "active");
  const monthlyTotal = active
    .filter((i) => i.frequency === "monthly")
    .reduce((s, i) => s + Number(i.amount), 0);

  const upcoming = active
    .filter((i) => i.frequency === "monthly")
    .map((i) => {
      const day = i.billing_day;
      const next = new Date(today.getFullYear(), today.getMonth(), day);
      if (next < today) next.setMonth(next.getMonth() + 1);
      const daysLeft = Math.ceil((next.getTime() - today.getTime()) / 86400000);
      return { ...i, next, daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const remove = async (id: string) => {
    if (!confirm("Excluir esta assinatura?")) return;
    const { error } = await supabase.from("recurring_expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removida");
    qc.invalidateQueries({ queryKey: ["recurring"] });
  };

  const toggleStatus = async (it: RecurringExpense) => {
    const newStatus = it.status === "active" ? "paused" : "active";
    const { error } = await supabase.from("recurring_expenses").update({ status: newStatus }).eq("id", it.id);
    if (error) return toast.error(error.message);
    toast.success(newStatus === "active" ? "Ativada" : "Pausada");
    qc.invalidateQueries({ queryKey: ["recurring"] });
  };

  const edit = (it: RecurringExpense) => { setEditing(it); setOpen(true); };
  const create = () => { setEditing(null); setOpen(true); };

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold">Assinaturas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {active.length} ativas · {formatCurrency(monthlyTotal)} por mês
          </p>
        </div>
        <Button onClick={create} className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Plus className="h-4 w-4 mr-2" /> Nova
        </Button>
      </header>

      {upcoming.length > 0 && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display text-lg">Próximas cobranças</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {upcoming.slice(0, 5).map((u) => (
                <li key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/40">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                      <Repeat className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">
                        em {u.daysLeft === 0 ? "hoje" : `${u.daysLeft} dia${u.daysLeft > 1 ? "s" : ""}`} · dia {u.billing_day}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-destructive">{formatCurrency(Number(u.amount))}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Todas as assinaturas</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhuma assinatura ainda. Cadastre Netflix, Spotify, academia...
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-4 py-3 group">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${i.categories?.color ?? "#22d3ee"}25`, color: i.categories?.color ?? "#22d3ee" }}>
                    <Repeat className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{i.name}</p>
                      <Badge variant={i.status === "active" ? "default" : "outline"} className={
                        i.status === "active" ? "bg-success/20 text-success border-success/30" :
                        i.status === "paused" ? "bg-warning/20 text-warning border-warning/30" :
                        "bg-muted text-muted-foreground"
                      }>{i.status === "active" ? "Ativa" : i.status === "paused" ? "Pausada" : "Cancelada"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {i.categories?.name ?? "—"} · {FREQUENCIES.find((f) => f.value === i.frequency)?.label} · dia {i.billing_day} · {paymentLabel(i.payment_method)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-destructive">{formatCurrency(Number(i.amount))}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => toggleStatus(i)} className="p-2 text-muted-foreground hover:text-primary">
                      {i.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button onClick={() => edit(i)} className="p-2 text-muted-foreground hover:text-primary">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => remove(i.id)} className="p-2 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RecurringDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
