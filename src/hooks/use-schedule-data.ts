import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hubKeys, type TaskFilters } from "@/lib/query-keys";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  category: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  priority: string;
  recurrence_rule: string | null;
  source_type: string | null;
  source_id: string | null;
  sync_enabled: boolean;
  google_event_id: string | null;
  sync_status: string;
}

const EVENT_COLUMNS =
  "id,title,description,category,starts_at,ends_at,all_day,location,priority,recurrence_rule,source_type,source_id,sync_enabled,google_event_id,sync_status";

/** Eventos do intervalo visível — sempre filtrado no servidor. */
export const useEvents = (fromISO: string, toISO: string) =>
  useQuery({
    queryKey: hubKeys.eventsRange(fromISO, toISO),
    queryFn: async (): Promise<CalendarEvent[]> => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select(EVENT_COLUMNS)
        .lt("starts_at", toISO)
        .gt("ends_at", fromISO)
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CalendarEvent[];
    },
  });

export interface Routine {
  id: string;
  name: string;
  description: string | null;
  category: string;
  objective: string | null;
  weekdays: number[];
  start_time: string;
  duration_minutes: number;
  reminder_minutes: number | null;
  alert_minutes: number | null;
  generate_events: boolean;
  status: string;
}

export const useRoutines = () =>
  useQuery({
    queryKey: hubKeys.routines,
    queryFn: async (): Promise<Routine[]> => {
      const { data, error } = await supabase
        .from("routines")
        .select(
          "id,name,description,category,objective,weekdays,start_time,duration_minutes,reminder_minutes,alert_minutes,generate_events,status",
        )
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Routine[];
    },
  });

export interface RoutineOccurrence {
  id: string;
  routine_id: string;
  occurrence_date: string;
  status: string;
}

export const useRoutineOccurrences = (fromDate: string, toDate: string) =>
  useQuery({
    queryKey: hubKeys.routineOccurrencesRange(fromDate, toDate),
    queryFn: async (): Promise<RoutineOccurrence[]> => {
      const { data, error } = await supabase
        .from("routine_occurrences")
        .select("id,routine_id,occurrence_date,status")
        .gte("occurrence_date", fromDate)
        .lte("occurrence_date", toDate);
      if (error) throw error;
      return (data ?? []) as RoutineOccurrence[];
    },
  });

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  due_at: string | null;
  estimated_minutes: number | null;
  event_id: string | null;
  routine_id: string | null;
  completed_at: string | null;
}

export const useTasks = (filters: TaskFilters = {}) =>
  useQuery({
    queryKey: hubKeys.tasksList(filters),
    queryFn: async (): Promise<Task[]> => {
      let q = supabase
        .from("tasks")
        .select(
          "id,title,description,category,priority,status,due_at,estimated_minutes,event_id,routine_id,completed_at",
        );
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.category && filters.category !== "all") q = q.eq("category", filters.category);
      if (filters.priority && filters.priority !== "all") q = q.eq("priority", filters.priority);
      const { data, error } = await q
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 100);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

export interface AlertRow {
  id: string;
  title: string;
  body: string | null;
  source_type: string;
  source_id: string | null;
  trigger_at: string;
  channel: string;
  status: string;
  read_at: string | null;
}

/** Alertas pendentes ordenados por disparo — casa com idx_alerts_pending. */
export const useAlerts = (limit = 30) =>
  useQuery({
    queryKey: hubKeys.alertsUpcoming(limit),
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id,title,body,source_type,source_id,trigger_at,channel,status,read_at")
        .eq("status", "pending")
        .order("trigger_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

/**
 * Eventos próximos para vínculo de tarefas — janela e limite fixos,
 * evitando leitura ilimitada da agenda.
 */
export const useLinkableEvents = (limit = 50) =>
  useQuery({
    queryKey: [...hubKeys.events, "linkable", limit] as const,
    queryFn: async (): Promise<Pick<CalendarEvent, "id" | "title" | "starts_at">[]> => {
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("calendar_events")
        .select("id,title,starts_at")
        .gte("starts_at", from)
        .order("starts_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Pick<CalendarEvent, "id" | "title" | "starts_at">[];
    },
  });

export interface CalendarIntegration {
  id: string;
  provider: string;
  calendar_id: string | null;
  account_email: string | null;
  status: string;
  connected_at: string | null;
  last_error: string | null;
}

export const useCalendarIntegration = () =>
  useQuery({
    queryKey: hubKeys.calendarIntegration,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CalendarIntegration | null> => {
      const { data, error } = await supabase
        .from("calendar_integrations")
        .select("id,provider,calendar_id,account_email,status,connected_at,last_error")
        .eq("provider", "google")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CalendarIntegration | null;
    },
  });
