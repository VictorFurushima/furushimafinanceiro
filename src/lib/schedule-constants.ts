/** Constantes e helpers do módulo Agenda + Rotinas + Tarefas + Alertas. */

export const EVENT_CATEGORIES = [
  { value: "pessoal", label: "Pessoal", color: "#22d3ee" },
  { value: "trabalho", label: "Trabalho", color: "#6366f1" },
  { value: "estudo", label: "Estudo", color: "#a78bfa" },
  { value: "saude", label: "Saúde", color: "#10b981" },
  { value: "financeiro", label: "Financeiro", color: "#f59e0b" },
  { value: "lazer", label: "Lazer", color: "#ec4899" },
] as const;

export const categoryLabel = (v?: string | null) =>
  EVENT_CATEGORIES.find((c) => c.value === v)?.label ?? "Pessoal";

export const categoryColor = (v?: string | null) =>
  EVENT_CATEGORIES.find((c) => c.value === v)?.color ?? "#64748b";

export const PRIORITIES = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
] as const;

export const priorityLabel = (v?: string | null) =>
  PRIORITIES.find((p) => p.value === v)?.label ?? "Média";

export const TASK_STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
] as const;

export const taskStatusLabel = (v?: string | null) =>
  TASK_STATUSES.find((s) => s.value === v)?.label ?? "Pendente";

export const RECURRENCE_OPTIONS = [
  { value: "none", label: "Não se repete" },
  { value: "RRULE:FREQ=DAILY", label: "Diariamente" },
  { value: "RRULE:FREQ=WEEKLY", label: "Semanalmente" },
  { value: "RRULE:FREQ=MONTHLY", label: "Mensalmente" },
] as const;

export const REMINDER_OPTIONS = [
  { value: "0", label: "Sem lembrete" },
  { value: "5", label: "5 min antes" },
  { value: "15", label: "15 min antes" },
  { value: "30", label: "30 min antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 dia antes" },
] as const;

export const WEEKDAYS = [
  { value: 0, short: "Dom", label: "Domingo" },
  { value: 1, short: "Seg", label: "Segunda" },
  { value: 2, short: "Ter", label: "Terça" },
  { value: 3, short: "Qua", label: "Quarta" },
  { value: 4, short: "Qui", label: "Quinta" },
  { value: 5, short: "Sex", label: "Sexta" },
  { value: 6, short: "Sáb", label: "Sábado" },
] as const;

/** Data local (não UTC) no formato YYYY-MM-DD. */
export function localDateISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  return startOfDay(addDays(d, -d.getDay()));
}

export function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const fmtDateLong = (d: Date) =>
  d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

/** Formata uma duração em minutos como "2h 15min". */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return `${h}h ${rest}min`;
  if (h) return `${h}h`;
  return `${rest}min`;
}

/** Valor para <input type="datetime-local"> a partir de um ISO/Date. */
export function toLocalInput(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
