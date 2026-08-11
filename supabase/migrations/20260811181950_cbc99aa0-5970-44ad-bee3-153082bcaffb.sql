-- Objetivo: introduz modulo Agenda + Rotinas + Tarefas + Alertas (hub pessoal)
-- Tabelas afetadas: calendar_events, routines, routine_occurrences, tasks, alerts, calendar_integrations (novas)
-- Impacto de dados: nenhum (apenas criacao)
-- RLS: policies novas no padrao admin_write / space_read com InitPlan
-- Indices/FKs: indices orientados as queries de agenda/tarefas/alertas
-- Rollback: DROP TABLE public.alerts, public.routine_occurrences, public.tasks, public.calendar_events, public.routines, public.calendar_integrations;

CREATE TABLE public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'pessoal',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  priority text NOT NULL DEFAULT 'media',
  recurrence_rule text,
  source_type text,
  source_id uuid,
  sync_enabled boolean NOT NULL DEFAULT false,
  google_event_id text,
  sync_status text NOT NULL DEFAULT 'local',
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_events_space_read ON public.calendar_events FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY calendar_events_admin_write ON public.calendar_events FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE INDEX idx_calendar_events_user_starts ON public.calendar_events (user_id, starts_at);
CREATE UNIQUE INDEX idx_calendar_events_google_id ON public.calendar_events (user_id, google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX idx_calendar_events_source ON public.calendar_events (user_id, source_type, source_id) WHERE source_type IS NOT NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'pessoal',
  objective text,
  weekdays smallint[] NOT NULL DEFAULT '{}',
  start_time time NOT NULL DEFAULT '08:00',
  duration_minutes integer NOT NULL DEFAULT 30,
  reminder_minutes integer,
  alert_minutes integer,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  generate_events boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routines TO authenticated;
GRANT ALL ON public.routines TO service_role;
ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;
CREATE POLICY routines_space_read ON public.routines FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY routines_admin_write ON public.routines FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE INDEX idx_routines_user_status ON public.routines (user_id, status);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.routine_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id uuid NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status text NOT NULL DEFAULT 'done',
  completed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routine_id, occurrence_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_occurrences TO authenticated;
GRANT ALL ON public.routine_occurrences TO service_role;
ALTER TABLE public.routine_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY routine_occurrences_space_read ON public.routine_occurrences FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY routine_occurrences_admin_write ON public.routine_occurrences FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE INDEX idx_routine_occurrences_user_date ON public.routine_occurrences (user_id, occurrence_date);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'pessoal',
  priority text NOT NULL DEFAULT 'media',
  status text NOT NULL DEFAULT 'pendente',
  due_at timestamptz,
  estimated_minutes integer,
  event_id uuid REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  routine_id uuid REFERENCES public.routines(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_space_read ON public.tasks FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY tasks_admin_write ON public.tasks FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE INDEX idx_tasks_user_status_due ON public.tasks (user_id, status, due_at);
CREATE INDEX idx_tasks_event ON public.tasks (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_tasks_routine ON public.tasks (routine_id) WHERE routine_id IS NOT NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  trigger_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'app',
  status text NOT NULL DEFAULT 'pending',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY alerts_space_read ON public.alerts FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY alerts_admin_write ON public.alerts FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE INDEX idx_alerts_pending ON public.alerts (user_id, trigger_at) WHERE status = 'pending';
CREATE INDEX idx_alerts_source ON public.alerts (user_id, source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE public.calendar_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google',
  calendar_id text,
  account_email text,
  status text NOT NULL DEFAULT 'disconnected',
  connected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_integrations TO authenticated;
GRANT ALL ON public.calendar_integrations TO service_role;
ALTER TABLE public.calendar_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_integrations_space_read ON public.calendar_integrations FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY calendar_integrations_admin_write ON public.calendar_integrations FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.calendar_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Conclusao idempotente de rotina do dia (nao altera a definicao da rotina)
CREATE OR REPLACE FUNCTION public.complete_routine_occurrence(p_routine_id uuid, p_date date)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.routines WHERE id = p_routine_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'rotina nao encontrada';
  END IF;
  INSERT INTO public.routine_occurrences (user_id, routine_id, occurrence_date, status)
  VALUES (v_uid, p_routine_id, COALESCE(p_date, CURRENT_DATE), 'done')
  ON CONFLICT (routine_id, occurrence_date)
    DO UPDATE SET status = 'done', completed_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;