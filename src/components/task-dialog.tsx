import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import { useRoutines, useLinkableEvents, type Task } from "@/hooks/use-schedule-data";
import {
  EVENT_CATEGORIES, PRIORITIES, TASK_STATUSES, toLocalInput,
} from "@/lib/schedule-constants";

export function TaskDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: Task | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: routines = [] } = useRoutines();
  const { data: linkableEvents = [] } = useLinkableEvents();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("pessoal");
  const [priority, setPriority] = useState("media");
  const [status, setStatus] = useState("pendente");
  const [dueAt, setDueAt] = useState("");
  const [estimated, setEstimated] = useState("");
  const [routineId, setRoutineId] = useState("none");
  const [eventId, setEventId] = useState("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setDescription(editing?.description ?? "");
    setCategory(editing?.category ?? "pessoal");
    setPriority(editing?.priority ?? "media");
    setStatus(editing?.status ?? "pendente");
    setDueAt(editing?.due_at ? toLocalInput(editing.due_at) : "");
    setEstimated(editing?.estimated_minutes ? String(editing.estimated_minutes) : "");
    setRoutineId(editing?.routine_id ?? "none");
    setEventId(editing?.event_id ?? "none");
  }, [open, editing]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!title.trim()) return toast.error("Informe o título da tarefa");

    setSaving(true);
    const payload = {
      user_id: user.id,
      title: title.trim(),
      description: description.trim() || null,
      category,
      priority,
      status,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      estimated_minutes: estimated ? Number(estimated) : null,
      routine_id: routineId === "none" ? null : routineId,
      event_id: eventId === "none" ? null : eventId,
      completed_at: status === "concluida" ? new Date().toISOString() : null,
    };

    const { error } = editing
      ? await supabase.from("tasks").update(payload).eq("id", editing.id)
      : await supabase.from("tasks").insert(payload);

    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Tarefa atualizada" : "Tarefa criada");
    invalidateFinance(qc, "tasks");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>Organize o que precisa ser feito, com prazo e prioridade.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tk-title">Título</Label>
            <Input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
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
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tk-due">Prazo (opcional)</Label>
              <Input id="tk-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tk-est">Duração estimada (min)</Label>
              <Input id="tk-est" type="number" min={5} step={5} value={estimated}
                onChange={(e) => setEstimated(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rotina vinculada</Label>
              <Select value={routineId} onValueChange={setRoutineId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem vínculo</SelectItem>
                  {routines.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Compromisso vinculado</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vínculo</SelectItem>
                {linkableEvents.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {new Date(ev.starts_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {ev.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tk-desc">Descrição</Label>
            <Textarea id="tk-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
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
