-- Objetivo: harmonizar convencao de source_type financeiro e tornar a materializacao
--           de rotinas convergente (remove slots futuros obsoletos apos edicao).
-- Tabelas afetadas: calendar_events (indice), funcao materialize_routine_events
-- Impacto de dados: remove apenas eventos futuros de rotina que nao correspondem mais a definicao atual
-- RLS: inalterada
-- Rollback: recriar idx_calendar_events_finance_source com a lista antiga e a versao anterior da funcao

DROP INDEX IF EXISTS idx_calendar_events_finance_source;

CREATE UNIQUE INDEX idx_calendar_events_finance_source
  ON public.calendar_events (user_id, source_type, source_id)
  WHERE source_type IN ('bill', 'credit_card_bill', 'recurring');

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

  CREATE TEMP TABLE _routine_slots ON COMMIT DROP AS
  WITH d AS (
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + v_days, interval '1 day')::date AS day
  )
  SELECT r.id AS routine_id, r.name, r.description, r.category, r.duration_minutes,
         ((d.day + r.start_time) AT TIME ZONE r.timezone) AS starts_at
  FROM public.routines r
  CROSS JOIN d
  WHERE r.user_id = v_uid
    AND r.status = 'active'
    AND r.generate_events = true
    AND EXTRACT(DOW FROM d.day)::smallint = ANY (r.weekdays);

  -- Convergencia: qualquer evento futuro de rotina que nao corresponda mais a
  -- definicao atual (rotina pausada, sem geracao, dia/horario alterado) sai da agenda.
  DELETE FROM public.calendar_events e
  WHERE e.user_id = v_uid
    AND e.source_type = 'routine'
    AND e.starts_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM _routine_slots s
      WHERE s.routine_id = e.source_id AND s.starts_at = e.starts_at
    );

  WITH ins AS (
    INSERT INTO public.calendar_events
      (user_id, title, description, category, starts_at, ends_at, source_type, source_id)
    SELECT v_uid, s.name, s.description, s.category, s.starts_at,
           s.starts_at + make_interval(mins => s.duration_minutes), 'routine', s.routine_id
    FROM _routine_slots s
    WHERE s.starts_at >= now()
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  DROP TABLE IF EXISTS _routine_slots;

  RETURN v_count;
END; $$;