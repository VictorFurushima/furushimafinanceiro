import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskDialog } from "@/components/task-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { useTasks, type Task } from "@/hooks/use-schedule-data";
import {
  categoryLabel,
  EVENT_CATEGORIES,
  PRIORITIES,
  priorityLabel,
  TASK_STATUSES,
  taskStatusLabel,
} from "@/lib/schedule-constants";

export const Route = createFileRoute("/_app/tasks")({
  component: TasksPage,
  head: () => ({
    meta: [
      { title: "Tarefas — Furushima" },
      {
        name: "description",
        content: "Liste, priorize e conclua suas tarefas com prazos e categorias.",
      },
    ],
  }),
});

function TasksPage() {
  const { isAdmin } = useRole();
  const qc = useQueryClient();

  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const { data: tasks = [], isLoading } = useTasks({ status, category, priority, limit: 100 });

  const toggle = async (t: Task) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    const done = t.status === "concluida";
    const { error } = await supabase
      .from("tasks")
      .update({
        status: done ? "pendente" : "concluida",
        completed_at: done ? null : new Date().toISOString(),
      })
      .eq("id", t.id);
    if (error) return toast.error(error.message);
    invalidateFinance(qc, "tasks");
  };

  const remove = async (t: Task) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!confirm(`Excluir a tarefa "${t.title}"?`)) return;
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("Tarefa excluída");
    invalidateFinance(qc, "tasks");
  };

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">O que precisa ser feito</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Tarefas</h1>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="w-full sm:w-auto min-h-11 bg-gradient-primary text-primary-foreground shadow-glow"
          >
            <Plus className="h-4 w-4 mr-2" /> Nova tarefa
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Filtrar por categoria">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {EVENT_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger aria-label="Filtrar por prioridade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as prioridades</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
      ) : tasks.length === 0 ? (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="py-14 text-center space-y-2">
            <ListTodo className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma tarefa encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => {
            const done = t.status === "concluida";
            return (
              <Card key={t.id} className="bg-gradient-card border-border/50 shadow-card">
                <CardContent className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggle(t)}
                    aria-label={done ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary-glow"
                  >
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-primary-glow" />
                    ) : (
                      <Circle className="h-5 w-5" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium truncate ${done ? "line-through text-muted-foreground" : ""}`}
                    >
                      {t.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {categoryLabel(t.category)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {priorityLabel(t.priority)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {taskStatusLabel(t.status)}
                      </span>
                      {t.due_at && (
                        <span className="text-xs text-muted-foreground">
                          ·{" "}
                          {new Date(t.due_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(t);
                          setOpen(true);
                        }}
                        aria-label="Editar tarefa"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove(t)}
                        aria-label="Excluir tarefa"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <TaskDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
