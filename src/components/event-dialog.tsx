import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import type { CalendarEvent } from "@/hooks/use-schedule-data";
import {
  EVENT_CATEGORIES,
  PRIORITIES,
  RECURRENCE_OPTIONS,
  REMINDER_OPTIONS,
  toLocalInput,
} from "@/lib/schedule-constants";
import { pushEventToGoogle } from "@/lib/calendar-sync.functions";

export function EventDialog({
  open,
  onOpenChange,
  editing,
  defaultStart,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: CalendarEvent | null;
  defaultStart?: Date;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const push = useServerFn(pushEventToGoogle);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("pessoal");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [priority, setPriority] = useState("media");
  const [recurrence, setRecurrence] = useState("none");
  const [reminder, setReminder] = useState("0");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [createAlert, setCreateAlert] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = defaultStart ?? new Date();
    const start = editing ? new Date(editing.starts_at) : base;
    const end = editing ? new Date(editing.ends_at) : new Date(base.getTime() + 60 * 60_000);
    setTitle(editing?.title ?? "");
    setCategory(editing?.category ?? "pessoal");
    setStartsAt(toLocalInput(start));
    setEndsAt(toLocalInput(end));
    setAllDay(editing?.all_day ?? false);
    setDescription(editing?.description ?? "");
    setLocation(editing?.location ?? "");
    setPriority(editing?.priority ?? "media");
    setRecurrence(editing?.recurrence_rule ?? "none");
    setReminder("0");
    setSyncEnabled(editing?.sync_enabled ?? false);
    setCreateAlert(false);
  }, [open, editing, defaultStart]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!title.trim()) return toast.error("Informe o título do compromisso");
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(start.getTime() < end.getTime())) return toast.error("O fim deve ser depois do início");

    setSaving(true);
    const payload = {
      user_id: user.id,
      title: title.trim(),
      description: description.trim() || null,
      category,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: allDay,
      location: location.trim() || null,
      priority,
      recurrence_rule: recurrence === "none" ? null : recurrence,
      sync_enabled: syncEnabled,
    };

    const res = editing
      ? await supabase
          .from("calendar_events")
          .update(payload)
          .eq("id", editing.id)
          .select("id")
          .maybeSingle()
      : await supabase.from("calendar_events").insert(payload).select("id").maybeSingle();

    if (res.error) {
      setSaving(false);
      return toast.error(res.error.message);
    }
    const eventId = res.data?.id as string | undefined;

    const minutes = Number(reminder);
    if (createAlert && eventId && minutes >= 0) {
      const triggerAt = new Date(start.getTime() - minutes * 60_000).toISOString();
      const { error } = await supabase.from("alerts").insert({
        user_id: user.id,
        title: title.trim(),
        body: location.trim() || null,
        source_type: "event",
        source_id: eventId,
        trigger_at: triggerAt,
      });
      if (error) toast.error(`Compromisso salvo, mas o alerta falhou: ${error.message}`);
    }

    toast.success(editing ? "Compromisso atualizado" : "Compromisso criado");
    invalidateFinance(qc, "events");
    setSaving(false);
    onOpenChange(false);

    if (syncEnabled && eventId) {
      const result = await push({ data: { eventId } });
      if (!result.synced) {
        if (result.reason === "not_configured") {
          toast.info("Google Calendar ainda não está conectado — o compromisso ficou salvo aqui.");
        } else if (result.reason === "error") {
          toast.error(
            "Falha ao enviar ao Google. O compromisso local está seguro; tente reenviar.",
          );
        }
      } else {
        toast.success("Enviado ao Google Calendar");
      }
      invalidateFinance(qc, "events");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {editing ? "Editar compromisso" : "Novo compromisso"}
          </DialogTitle>
          <DialogDescription>
            Os dados ficam salvos no Furushima; o Google é apenas espelho.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ev-title">Título</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ev-start">Início</Label>
              <Input
                id="ev-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-end">Fim</Label>
              <Input
                id="ev-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <Label htmlFor="ev-allday" className="cursor-pointer">
              Dia inteiro
            </Label>
            <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ev-local">Local</Label>
            <Input id="ev-local" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ev-desc">Descrição</Label>
            <Textarea
              id="ev-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Recorrência</Label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lembrete</Label>
              <Select value={reminder} onValueChange={setReminder}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <Label htmlFor="ev-alert" className="cursor-pointer">
              Criar alerta
            </Label>
            <Switch id="ev-alert" checked={createAlert} onCheckedChange={setCreateAlert} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
            <div>
              <Label htmlFor="ev-sync" className="cursor-pointer">
                Adicionar ao calendário
              </Label>
              <p className="text-xs text-muted-foreground">
                Envia para o Google Calendar quando conectado.
              </p>
            </div>
            <Switch id="ev-sync" checked={syncEnabled} onCheckedChange={setSyncEnabled} />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="min-h-11 bg-gradient-primary text-primary-foreground shadow-glow"
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
