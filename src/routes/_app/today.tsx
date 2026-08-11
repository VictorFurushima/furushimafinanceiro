import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Circle, Plus, Repeat, Bell, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EventDialog } from "@/components/event-dialog";
import { TaskDialog } from "@/components/task-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { useFinancialOverview, useDashboardSnapshot } from "@/hooks/use-finance-aggregates";
import { formatCurrency } from "@/lib/format";
import {
  useEvents,
  useRoutines,
  useRoutineOccurrences,
  useTasks,
  useAlerts,
} from "@/hooks/use-schedule-data";
import {
  categoryColor,
  endOfDay,
  fmtDateLong,
  fmtDuration,
  fmtTime,
  localDateISO,
  startOfDay,
} from "@/lib/schedule-constants";

export const Route = createFileRoute("/_app/today")({
  component: TodayPage,
  head: () => ({
    meta: [
      { title: "Hoje — Furushima" },
      {
        name: "description",
        content: "Compromissos, rotinas, tarefas, alertas e finanças do seu dia em uma única tela.",
      },
    ],
  }),
});

function TodayPage() {
  const today = useMemo(() => new Date(), []);
  const from = startOfDay(today).toISOString();
  const to = endOfDay(today).toISOString();
  const dateISO = localDateISO(today);

  const { isAdmin } = useRole();
  const qc = useQueryClient();

  const { data: events = [], isLoading: loadingEvents } = useEvents(from, to);
  const { data: routines = [], isLoading: loadingRoutines } = useRoutines();
  const { data: occurrences = [], isLoading: loadingOcc } = useRoutineOccurrences(dateISO, dateISO);
  const { data: tasks = [], isLoading: loadingTasks } = useTasks({ status: "pendente", limit: 20 });
  const { data: alerts = [] } = useAlerts(10);
  const { data: overview, isLoading: loadingOverview } = useFinancialOverview();
  const { data: snapshot, isLoading: loadingSnapshot } = useDashboardSnapshot();

  const [eventOpen, setEventOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const todayRoutines = useMemo(
    () => routines.filter((r) => r.status === "active" && r.weekdays.includes(today.getDay())),
    [routines, today],
  );
  const doneIds = useMemo(
    () => new Set(occurrences.filter((o) => o.status === "concluida").map((o) => o.routine_id)),
    [occurrences],
  );

  const nextEvent = useMemo(
    () => events.find((e) => new Date(e.starts_at).getTime() > Date.now()) ?? null,
    [events],
  );
  const minutesToNext = nextEvent
    ? Math.round((new Date(nextEvent.starts_at).getTime() - Date.now()) / 60_000)
    : null;

  const busyMinutes = events.reduce(
    (acc, e) => acc + (new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()) / 60_000,
    0,
  );
  const routineMinutes = todayRoutines.reduce((acc, r) => acc + r.duration_minutes, 0);
  const freeMinutes = Math.max(0, 16 * 60 - busyMinutes - routineMinutes);
  const loadingAgenda = loadingEvents || loadingRoutines || loadingOcc || loadingTasks;

  const toggleRoutine = async (routineId: string, done: boolean) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const { error } = await supabase.rpc("complete_routine_occurrence", {
      p_routine_id: routineId,
      p_date: dateISO,
      p_status: done ? "pendente" : "concluida",
    });
    if (error) return toast.error(error.message);
    invalidateFinance(qc, "routines");
  };

  const completeTask = async (id: string) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const { error } = await supabase
      .from("tasks")
      .update({ status: "concluida", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Tarefa concluída");
    invalidateFinance(qc, "tasks");
  };

  const markAlertRead = async (id: string) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const { error } = await supabase
      .from("alerts")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    invalidateFinance(qc, "alerts");
  };

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground capitalize">
            {fmtDateLong(today)}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Hoje</h1>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              onClick={() => setEventOpen(true)}
              className="flex-1 sm:flex-none min-h-11 bg-gradient-primary text-primary-foreground shadow-glow"
            >
              <Plus className="h-4 w-4 mr-2" /> Compromisso
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none min-h-11"
              onClick={() => setTaskOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" /> Tarefa
            </Button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Compromissos" value={String(events.length)} loading={loadingEvents} />
        <SummaryCard
          label="Rotinas do dia"
          value={`${doneIds.size}/${todayRoutines.length}`}
          loading={loadingRoutines || loadingOcc}
        />
        <SummaryCard
          label="Tarefas pendentes"
          value={String(tasks.length)}
          loading={loadingTasks}
        />
        <SummaryCard
          label="Tempo livre estimado"
          value={fmtDuration(freeMinutes)}
          loading={loadingAgenda}
        />
      </div>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardContent className="p-3 sm:p-4">
          {loadingEvents ? (
            <Skeleton className="h-10 w-full" />
          ) : nextEvent ? (
            <div className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: categoryColor(nextEvent.category) }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Próximo compromisso</p>
                <p className="text-sm font-medium truncate">{nextEvent.title}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-display font-bold">{fmtTime(nextEvent.starts_at)}</p>
                <p className="text-[11px] text-muted-foreground">
                  em {fmtDuration(minutesToNext ?? 0)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum compromisso restante hoje.</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Resumo financeiro
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingOverview || loadingSnapshot ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MiniStat
                label="Saldo disponível"
                value={formatCurrency(overview?.saldo_disponivel ?? 0)}
              />
              <MiniStat
                label="Gastos do mês"
                value={formatCurrency(overview?.gastos_reais_mes ?? 0)}
              />
              <MiniStat
                label="Faturas em aberto"
                value={formatCurrency(overview?.faturas_abertas ?? 0)}
              />
              <MiniStat
                label="Contas vencendo (5d)"
                value={String(snapshot?.upcoming_bills_count ?? 0)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Agenda de hoje
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingEvents ? (
            <Skeleton className="h-16 w-full" />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum compromisso hoje.
            </p>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-lg border border-border/40 p-3"
              >
                <span
                  className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: categoryColor(e.category) }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.all_day ? "Dia inteiro" : `${fmtTime(e.starts_at)} — ${fmtTime(e.ends_at)}`}
                    {e.location ? ` · ${e.location}` : ""}
                  </p>
                </div>
                {e.sync_status === "synced" && (
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    Google
                  </Badge>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
              <Repeat className="h-4 w-4" /> Rotinas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingRoutines || loadingOcc ? (
              <Skeleton className="h-16 w-full" />
            ) : todayRoutines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhuma rotina para hoje.
              </p>
            ) : (
              todayRoutines.map((r) => {
                const done = doneIds.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRoutine(r.id, done)}
                    className="flex w-full min-h-11 items-center gap-3 rounded-lg border border-border/40 p-3 text-left hover:bg-muted/30 transition"
                  >
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-primary-glow shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm truncate ${done ? "line-through text-muted-foreground" : ""}`}
                      >
                        {r.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.start_time.slice(0, 5)} · {fmtDuration(r.duration_minutes)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base sm:text-lg">Tarefas pendentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingTasks ? (
              <Skeleton className="h-16 w-full" />
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nada pendente. Bom trabalho!
              </p>
            ) : (
              tasks.slice(0, 8).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg border border-border/40 p-3"
                >
                  <button
                    type="button"
                    onClick={() => completeTask(t.id)}
                    aria-label={`Concluir ${t.title}`}
                    className="flex h-11 w-11 -m-2 items-center justify-center text-muted-foreground hover:text-primary-glow"
                  >
                    <Circle className="h-5 w-5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{t.title}</p>
                    {t.due_at && (
                      <p className="text-xs text-muted-foreground">
                        Prazo{" "}
                        {new Date(t.due_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {t.priority}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {alerts.length > 0 && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
              <Bell className="h-4 w-4" /> Alertas pendentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/40 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.trigger_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 shrink-0"
                    onClick={() => markAlertRead(a.id)}
                  >
                    Marcar lido
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <EventDialog open={eventOpen} onOpenChange={setEventOpen} editing={null} />
      <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} editing={null} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-gradient-card border-border/50 shadow-card">
      <CardContent className="p-3 sm:p-4">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p className="text-lg sm:text-2xl font-display font-bold">{value}</p>
        )}
        <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 p-3">
      <p className="text-sm sm:text-base font-display font-bold truncate">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
