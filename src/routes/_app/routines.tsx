import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RoutineDialog } from "@/components/routine-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { useRoutines, useRoutineOccurrences, type Routine } from "@/hooks/use-schedule-data";
import { addDays, categoryLabel, fmtDuration, localDateISO, startOfWeek, WEEKDAYS } from "@/lib/schedule-constants";

export const Route = createFileRoute("/_app/routines")({
  component: RoutinesPage,
  head: () => ({
    meta: [
      { title: "Rotinas — Furushima" },
      { name: "description", content: "Crie rotinas semanais com horário, duração, lembretes e objetivos." },
    ],
  }),
});

function RoutinesPage() {
  const { data: routines = [], isLoading } = useRoutines();
  const { isAdmin } = useRole();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);

  // Progresso semanal: uma única leitura da semana corrente, agregada em memória
  // apenas sobre as ocorrências já filtradas por RLS (conjunto pequeno).
  const week = useMemo(() => {
    const start = startOfWeek(new Date());
    return { fromISO: localDateISO(start), toISO: localDateISO(addDays(start, 6)), start };
  }, []);
  const { data: weekOccurrences = [] } = useRoutineOccurrences(week.fromISO, week.toISO);
  const doneByRoutine = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of weekOccurrences) {
      if (o.status !== "concluida") continue;
      map.set(o.routine_id, (map.get(o.routine_id) ?? 0) + 1);
    }
    return map;
  }, [weekOccurrences]);

  const remove = async (r: Routine) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!confirm(`Excluir a rotina "${r.name}"?`)) return;
    const { error } = await supabase.from("routines").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Rotina excluída");
    invalidateFinance(qc, "routines");
  };

  const toggleStatus = async (r: Routine) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const status = r.status === "active" ? "paused" : "active";
    const { error } = await supabase.from("routines").update({ status }).eq("id", r.id);
    if (error) return toast.error(error.message);
    // Reprocessa a janela materializada: pausar remove os eventos futuros gerados.
    const { error: matError } = await supabase.rpc("materialize_routine_events", { p_days: 30 });
    if (matError) toast.error(`Status alterado, mas a agenda não foi atualizada: ${matError.message}`);
    invalidateFinance(qc, "routines");
    invalidateFinance(qc, "events");
  };

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">Seus hábitos recorrentes</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Rotinas</h1>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditing(null); setOpen(true); }}
            className="w-full sm:w-auto min-h-11 bg-gradient-primary text-primary-foreground shadow-glow">
            <Plus className="h-4 w-4 mr-2" /> Nova rotina
          </Button>
        )}
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
      ) : routines.length === 0 ? (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="py-14 text-center space-y-2">
            <Repeat className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma rotina cadastrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {routines.map((r) => (
            <Card key={r.id} className="bg-gradient-card border-border/50 shadow-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="font-display text-base sm:text-lg leading-tight">{r.name}</CardTitle>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} aria-label="Editar rotina">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label="Excluir rotina">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{categoryLabel(r.category)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {r.start_time.slice(0, 5)} · {fmtDuration(r.duration_minutes)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => (
                    <span key={d.value}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        r.weekdays.includes(d.value)
                          ? "bg-primary/20 text-primary-glow"
                          : "text-muted-foreground/50"
                      }`}>
                      {d.short}
                    </span>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progresso da semana</span>
                    <span>{doneByRoutine.get(r.id) ?? 0}/{r.weekdays.length}</span>
                  </div>
                  <Progress
                    value={r.weekdays.length ? Math.min(100, ((doneByRoutine.get(r.id) ?? 0) / r.weekdays.length) * 100) : 0}
                    className="h-1.5"
                  />
                </div>
                {r.objective && <p className="text-xs text-muted-foreground">Objetivo: {r.objective}</p>}
                {isAdmin && (
                  <Button variant="outline" className="min-h-11 w-full" onClick={() => toggleStatus(r)}>
                    {r.status === "active" ? "Pausar rotina" : "Reativar rotina"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RoutineDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
