-- Objetivo: corrige convencao de status de rotinas, materializa eventos de rotina em janela curta,
--           reforca idempotencia de eventos originados de rotina/financeiro e adiciona CHECKs simples.
-- Tabelas afetadas: routine_occurrences, calendar_events, routines, tasks, alerts
-- Impacto de dados: nenhum (tabelas do hub estao vazias)
-- RLS: inalterada (escrita continua restrita a admin pelas policies existentes)
-- Indices/FKs: 1 indice UNIQUE parcial para rotina + 1 UNIQUE parcial para origem financeira
-- Rollback: DROP FUNCTION public.materialize_routine_events(integer); DROP INDEX idx_calendar_events_routine_slot, idx_calendar_events_finance_source;

-- 1. Convencao unica de status de ocorrencia: 'concluida' | 'pendente'
ALTER TABLE public.routine_occurrences ALTER COLUMN status SET DEFAULT 'concluida';
ALTER TABLE public.routine_occurrences ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE public.routine_occurrences
  ADD CONSTRAINT routine_occurrences_status_check CHECK (status IN ('concluida','pendente'));

DROP FUNCTION IF EXISTS public.complete_routine_occurrence(uuid, date);

CREATE OR REPLACE FUNCTION public.complete_routine_occurrence(
  p_routine_id uuid, p_date date, p_status text DEFAULT 'concluida'
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_status text := COALESCE(p_status, 'concluida');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'somente administradores podem alterar rotinas'; END IF;
  IF v_status NOT IN ('concluida','pendente') THEN RAISE EXCEPTION 'status invalido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.routines WHERE id = p_routine_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'rotina nao encontrada';
  END IF;

  INSERT INTO public.routine_occurrences (user_id, routine_id, occurrence_date, status, completed_at)
  VALUES (v_uid, p_routine_id, COALESCE(p_date, CURRENT_DATE), v_status,
          CASE WHEN v_status = 'concluida' THEN now() ELSE NULL END)
  ON CONFLICT (routine_id, occurrence_date) DO UPDATE
    SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at
  RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

-- 2. Idempotencia de eventos gerados por rotina e por origem financeira
CREATE UNIQUE INDEX idx_calendar_events_routine_slot
  ON public.calendar_events (user_id, source_id, starts_at)
  WHERE source_type = 'routine';

CREATE UNIQUE INDEX idx_calendar_events_finance_source
  ON public.calendar_events (user_id, source_type, source_id)
  WHERE source_type IN ('bill','recurring');

-- 3. Materializacao de rotinas em janela curta (nunca infinita), set-based e idempotente
CREATE OR REPLACE FUNCTION public.materialize_routine_events(p_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 60);
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'somente administradores podem gerar compromissos'; END IF;

  -- Remove compromissos futuros de rotinas pausadas ou sem geracao ativa
  DELETE FROM public.calendar_events e
  USING public.routines r
  WHERE e.user_id = v_uid
    AND e.source_type = 'routine'
    AND e.source_id = r.id
    AND e.starts_at > now()
    AND (r.generate_events = false OR r.status <> 'active');

  WITH d AS (
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + v_days, interval '1 day')::date AS day
  ),
  slots AS (
    SELECT r.id, r.name, r.description, r.category, r.duration_minutes,
           ((d.day + r.start_time) AT TIME ZONE r.timezone) AS starts_at
    FROM public.routines r
    CROSS JOIN d
    WHERE r.user_id = v_uid
      AND r.status = 'active'
      AND r.generate_events = true
      AND EXTRACT(DOW FROM d.day)::smallint = ANY (r.weekdays)
  ),
  ins AS (
    INSERT INTO public.calendar_events
      (user_id, title, description, category, starts_at, ends_at, source_type, source_id)
    SELECT v_uid, s.name, s.description, s.category, s.starts_at,
           s.starts_at + make_interval(mins => s.duration_minutes), 'routine', s.id
    FROM slots s
    WHERE s.starts_at >= now()
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  RETURN v_count;
END; $$;

-- 4. CHECKs simples (tabelas vazias, sem risco de compatibilidade)
ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_period_check CHECK (ends_at >= starts_at),
  ADD CONSTRAINT calendar_events_sync_status_check CHECK (sync_status IN ('local','synced','error','pending'));
ALTER TABLE public.routines
  ADD CONSTRAINT routines_duration_check CHECK (duration_minutes > 0),
  ADD CONSTRAINT routines_status_check CHECK (status IN ('active','paused'));
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check CHECK (status IN ('pendente','em_andamento','concluida','cancelada'));
ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_status_check CHECK (status IN ('pending','sent','read','dismissed'));