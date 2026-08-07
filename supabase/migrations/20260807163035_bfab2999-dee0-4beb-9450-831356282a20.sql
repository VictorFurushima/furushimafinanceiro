-- Migration: add_goals_user_fk
-- Objetivo: completar integridade referencial (goals.user_id era a unica coluna user_id sem FK).
-- Pre-checagem: 0 registros orfaos.
-- Rollback: ALTER TABLE public.goals DROP CONSTRAINT goals_user_id_fkey;
ALTER TABLE public.goals
  ADD CONSTRAINT goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
