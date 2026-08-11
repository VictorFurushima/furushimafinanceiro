import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Target } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useGoals, type Goal } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { GoalDialog } from "@/components/goal-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/goals")({ component: GoalsPage });

function GoalsPage() {
  const { data: goals = [] } = useGoals();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const qc = useQueryClient();

  const remove = async (id: string) => {
    if (!confirm("Excluir esta meta?")) return;
    const { error } = await supabase.from("goals").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removida");
    invalidateFinance(qc, "goals");
  };

  const updateAmount = async (g: Goal, delta: number) => {
    const newAmount = Math.max(0, Number(g.current_amount) + delta);
    const { error } = await supabase
      .from("goals")
      .update({ current_amount: newAmount })
      .eq("id", g.id);
    if (error) return toast.error(error.message);
    invalidateFinance(qc, "goals");
  };

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Metas</h1>
          <p className="text-sm text-muted-foreground mt-1">{goals.length} metas em andamento</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="bg-gradient-primary text-primary-foreground shadow-glow"
        >
          <Plus className="h-4 w-4 mr-2" /> Nova meta
        </Button>
      </header>

      {goals.length === 0 ? (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="py-16 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Crie sua primeira meta financeira</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => {
            const pct = Math.min(100, (Number(g.current_amount) / Number(g.target_amount)) * 100);
            const remaining = Math.max(0, Number(g.target_amount) - Number(g.current_amount));
            const daysLeft = g.deadline
              ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000)
              : null;
            return (
              <Card
                key={g.id}
                className="bg-gradient-card border-border/50 shadow-card overflow-hidden"
              >
                <div className="h-1.5" style={{ background: g.color }} />
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="font-display text-lg">{g.name}</CardTitle>
                    {daysLeft !== null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {daysLeft > 0
                          ? `${daysLeft} dias restantes`
                          : daysLeft === 0
                            ? "Vence hoje"
                            : "Atrasada"}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditing(g);
                        setOpen(true);
                      }}
                      className="p-2 text-muted-foreground hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(g.id)}
                      className="p-2 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between">
                    <span className="font-display text-2xl font-bold">
                      {formatCurrency(Number(g.current_amount))}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / {formatCurrency(Number(g.target_amount))}
                    </span>
                  </div>
                  <Progress value={pct} className="[&>div]:bg-gradient-primary" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{pct.toFixed(1)}% concluído</span>
                    <span>Faltam {formatCurrency(remaining)}</span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Input
                      id={`add-${g.id}`}
                      placeholder="Adicionar R$"
                      inputMode="decimal"
                      className="h-9"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = parseFloat(
                            (e.target as HTMLInputElement).value.replace(",", "."),
                          );
                          if (v) {
                            updateAmount(g, v);
                            (e.target as HTMLInputElement).value = "";
                          }
                        }
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <GoalDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
