import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, RefreshCw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventDialog } from "@/components/event-dialog";
import { invalidateFinance } from "@/lib/query-keys";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { useEvents, type CalendarEvent } from "@/hooks/use-schedule-data";
import { pushEventToGoogle, deleteEventEverywhere } from "@/lib/calendar-sync.functions";
import {
  addDays,
  categoryColor,
  categoryLabel,
  endOfDay,
  endOfMonth,
  fmtTime,
  localDateISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "@/lib/schedule-constants";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/agenda")({
  component: AgendaPage,
  head: () => ({
    meta: [
      { title: "Agenda — Furushima" },
      {
        name: "description",
        content:
          "Visualize seus compromissos por dia, semana ou mês e envie-os ao Google Calendar.",
      },
    ],
  }),
});

type ViewMode = "day" | "week" | "month";

function AgendaPage() {
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const push = useServerFn(pushEventToGoogle);
  const removeEverywhere = useServerFn(deleteEventEverywhere);
  const [slotDialogStart, setSlotDialogStart] = useState<Date | null>(null);

  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === "day") return { rangeStart: startOfDay(anchor), rangeEnd: endOfDay(anchor) };
    if (view === "week") {
      const s = startOfWeek(anchor);
      return { rangeStart: s, rangeEnd: endOfDay(addDays(s, 6)) };
    }
    return { rangeStart: startOfMonth(anchor), rangeEnd: endOfMonth(anchor) };
  }, [view, anchor]);

  const { data: events = [], isLoading } = useEvents(
    rangeStart.toISOString(),
    rangeEnd.toISOString(),
  );

  /**
   * Ocorrências visíveis = eventos reais + expansão local da recurrence_rule.
   * As repetições são virtuais (não existem no banco) e por isso não recebem
   * ações destrutivas individuais.
   */
  const occurrences = useMemo<OccurrenceEvent[]>(() => {
    const out: OccurrenceEvent[] = events.map((e) => ({ ...e, virtual: false }));
    for (const e of events) {
      if (!e.recurrence_rule) continue;
      for (const o of expandRecurrence(
        e.starts_at,
        e.ends_at,
        e.recurrence_rule,
        rangeStart,
        rangeEnd,
      )) {
        out.push({ ...e, ...o, virtual: true });
      }
    }
    return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [events, rangeStart, rangeEnd]);

  const grouped = useMemo(() => {
    const map = new Map<string, OccurrenceEvent[]>();
    for (const e of occurrences) {
      const key = localDateISO(new Date(e.starts_at));
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;

  }, [occurrences]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [rangeStart, rangeEnd]);

  const step = (dir: number) => {
    setAnchor((prev) => {
      if (view === "day") return addDays(prev, dir);
      if (view === "week") return addDays(prev, dir * 7);
      return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
    });
  };

  const remove = async (e: CalendarEvent) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!confirm(`Excluir "${e.title}"?`)) return;
    // Exclusão passa pelo servidor: remove o espelho no Google antes do registro local.
    const res = await removeEverywhere({ data: { eventId: e.id } });
    invalidateFinance(qc, "events");
    if (res.deleted) toast.success("Compromisso excluído");
    else if (res.reason === "remote_error")
      toast.error("Não foi possível remover no Google. O compromisso local foi mantido.");
    else toast.error("Compromisso não encontrado");
  };

  /** Planejamento inteligente: janelas livres do dia âncora entre 08h e 22h. */
  const freeSlots = useMemo(() => {
    const dayStart = new Date(anchor);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(anchor);
    dayEnd.setHours(22, 0, 0, 0);
    const busy = (grouped.get(localDateISO(anchor)) ?? [])
      .filter((e) => !e.all_day)
      .map((e) => ({ s: new Date(e.starts_at), e: new Date(e.ends_at) }))
      .sort((a, b) => a.s.getTime() - b.s.getTime());

    const slots: { start: Date; end: Date; minutes: number }[] = [];
    let cursor = dayStart;
    for (const b of busy) {
      if (b.s > cursor) {
        const minutes = Math.round(
          (Math.min(b.s.getTime(), dayEnd.getTime()) - cursor.getTime()) / 60_000,
        );
        if (minutes >= 30)
          slots.push({
            start: new Date(cursor),
            end: new Date(Math.min(b.s.getTime(), dayEnd.getTime())),
            minutes,
          });
      }
      if (b.e > cursor) cursor = b.e;
    }
    if (cursor < dayEnd) {
      const minutes = Math.round((dayEnd.getTime() - cursor.getTime()) / 60_000);
      if (minutes >= 30) slots.push({ start: new Date(cursor), end: new Date(dayEnd), minutes });
    }
    return slots.sort((a, b) => b.minutes - a.minutes).slice(0, 3);
  }, [grouped, anchor]);

  const resync = async (e: CalendarEvent) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const res = await push({ data: { eventId: e.id } });
    if (res.synced) toast.success("Enviado ao Google Calendar");
    else if (res.reason === "not_configured")
      toast.info("Google Calendar ainda não está conectado.");
    else if (res.reason === "disabled")
      toast.info("Ative “Adicionar ao calendário” neste compromisso.");
    else toast.error("Falha ao enviar ao Google. O compromisso local segue salvo.");
    invalidateFinance(qc, "events");
  };

  const title =
    view === "month"
      ? anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : `${rangeStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} — ${rangeEnd.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">Seu calendário pessoal</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Agenda</h1>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="w-full sm:w-auto min-h-11 bg-gradient-primary text-primary-foreground shadow-glow"
          >
            <Plus className="h-4 w-4 mr-2" /> Novo compromisso
          </Button>
        )}
      </header>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={() => step(-1)}
            aria-label="Período anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={() => step(1)}
            aria-label="Próximo período"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => setAnchor(new Date())}>
            Hoje
          </Button>
        </div>
        <p className="text-sm text-muted-foreground capitalize flex-1">{title}</p>
        <div className="flex rounded-lg border border-border/60 p-1">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "flex-1 min-h-9 px-3 rounded-md text-xs transition",
                view === v
                  ? "bg-gradient-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      {isAdmin && freeSlots.length > 0 && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="p-3 sm:p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Planejamento inteligente · janelas livres em{" "}
              {anchor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              {freeSlots.map((s) => (
                <Button
                  key={s.start.toISOString()}
                  variant="outline"
                  className="min-h-11 flex-1 justify-between"
                  onClick={() => {
                    setEditing(null);
                    setSlotDialogStart(s.start);
                    setOpen(true);
                  }}
                >
                  <span>
                    {fmtTime(s.start.toISOString())} — {fmtTime(s.end.toISOString())}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.floor(s.minutes / 60)}h{String(s.minutes % 60).padStart(2, "0")}
                  </span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
      ) : (
        <div className="space-y-3">
          {days.map((d) => {
            const key = localDateISO(d);
            const list = grouped.get(key) ?? [];
            if (view === "month" && list.length === 0) return null;
            return (
              <Card key={key} className="bg-gradient-card border-border/50 shadow-card">
                <CardContent className="p-3 sm:p-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground capitalize">
                    {d.toLocaleDateString("pt-BR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </p>
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem compromissos.</p>
                  ) : (
                    list.map((e) => (
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
                            {e.all_day
                              ? "Dia inteiro"
                              : `${fmtTime(e.starts_at)} — ${fmtTime(e.ends_at)}`}
                            {` · ${categoryLabel(e.category)}`}
                          </p>
                          {e.sync_status === "error" && (
                            <Badge variant="outline" className="mt-1 text-[10px] text-destructive">
                              Erro no envio
                            </Badge>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 shrink-0">
                            {e.sync_enabled && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => resync(e)}
                                aria-label="Reenviar ao Google"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditing(e);
                                setOpen(true);
                              }}
                              aria-label="Editar compromisso"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => remove(e)}
                              aria-label="Excluir compromisso"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
          {view === "month" && events.length === 0 && (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhum compromisso neste mês.
            </p>
          )}
        </div>
      )}

      <EventDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setSlotDialogStart(null);
        }}
        editing={editing}
        defaultStart={slotDialogStart ?? anchor}
      />
    </div>
  );
}
