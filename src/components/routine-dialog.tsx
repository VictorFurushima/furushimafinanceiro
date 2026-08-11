import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import type { Routine } from "@/hooks/use-schedule-data";
import { EVENT_CATEGORIES, REMINDER_OPTIONS, WEEKDAYS } from "@/lib/schedule-constants";
import { cn } from "@/lib/utils";

export function RoutineDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: Routine | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("pessoal");
  const [objective, setObjective] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("08:00");
  const [duration, setDuration] = useState("30");
  const [reminder, setReminder] = useState("0");
  const [alertMinutes, setAlertMinutes] = useState("0");
  const [generateEvents, setGenerateEvents] = useState(false);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setCategory(editing?.category ?? "pessoal");
    setObjective(editing?.objective ?? "");
    setWeekdays(editing?.weekdays ?? []);
    setStartTime((editing?.start_time ?? "08:00").slice(0, 5));
    setDuration(String(editing?.duration_minutes ?? 30));
    setReminder(String(editing?.reminder_minutes ?? 0));
    setAlertMinutes(String(editing?.alert_minutes ?? 0));
    setGenerateEvents(editing?.generate_events ?? false);
    setActive((editing?.status ?? "active") === "active");
  }, [open, editing]);

  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!name.trim()) return toast.error("Informe o nome da rotina");
    if (weekdays.length === 0) return toast.error("Escolha ao menos um dia da semana");

    setSaving(true);
    const payload = {
      user_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
      category,
      objective: objective.trim() || null,
      weekdays,
      start_time: startTime,
      duration_minutes: Math.max(5, Number(duration) || 30),
      reminder_minutes: Number(reminder) || null,
      alert_minutes: Number(alertMinutes) || null,
      generate_events: generateEvents,
      status: active ? "active" : "paused",
    };

    const { error } = editing
      ? await supabase.from("routines").update(payload).eq("id", editing.id)
      : await supabase.from("routines").insert(payload);

    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Rotina atualizada" : "Rotina criada");
    invalidateFinance(qc, "routines");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Editar rotina" : "Nova rotina"}</DialogTitle>
          <DialogDescription>Defina os dias, o horário e o objetivo da rotina.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rt-name">Nome</Label>
            <Input id="rt-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Dias da semana</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                  aria-pressed={weekdays.includes(d.value)}
                  className={cn(
                    "min-h-11 min-w-11 px-3 rounded-lg text-xs border transition",
                    weekdays.includes(d.value)
                      ? "bg-gradient-primary text-primary-foreground border-transparent shadow-glow"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40",
                  )}>
                  {d.short}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rt-time">Horário</Label>
              <Input id="rt-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rt-dur">Duração (min)</Label>
              <Input id="rt-dur" type="number" min={5} step={5} value={duration}
                onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lembrete</Label>
              <Select value={reminder} onValueChange={setReminder}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Alerta</Label>
            <Select value={alertMinutes} onValueChange={setAlertMinutes}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.value === "0" ? "Sem alerta" : r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rt-obj">Objetivo</Label>
            <Input id="rt-obj" value={objective} onChange={(e) => setObjective(e.target.value)}
              placeholder="Ex.: treinar 4x por semana" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rt-desc">Descrição</Label>
            <Textarea id="rt-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <Label htmlFor="rt-gen" className="cursor-pointer">Gerar compromissos na agenda</Label>
            <Switch id="rt-gen" checked={generateEvents} onCheckedChange={setGenerateEvents} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <Label htmlFor="rt-active" className="cursor-pointer">Rotina ativa</Label>
            <Switch id="rt-active" checked={active} onCheckedChange={setActive} />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}
              className="min-h-11 bg-gradient-primary text-primary-foreground shadow-glow">
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
