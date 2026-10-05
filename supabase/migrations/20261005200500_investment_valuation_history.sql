-- Objetivo: manter historico real do valor da carteira, separado de acoes reversiveis.
-- Tabelas afetadas: private.investment_valuation_history e coletor de cotacoes.
-- Impacto de dados: captura a partir da ativacao, sem inventar saldos anteriores.
-- RLS: dados privados, leitura por RPC pelo titular/espectador do espaco.
-- Indices/FKs: titular+janela de 30 minutos, FK para auth.users.
-- Rollback: remover chamada do coletor, RPC e tabela privada.
CREATE TABLE private.investment_valuation_history (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 bucket timestamptz NOT NULL,captured_at timestamptz NOT NULL,
 invested numeric NOT NULL,value numeric NOT NULL,manual_count int NOT NULL,pending_count int NOT NULL,
 PRIMARY KEY(user_id,bucket)
);
REVOKE ALL ON private.investment_valuation_history FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.capture_investment_valuations() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
 INSERT INTO private.investment_valuation_history(user_id,bucket,captured_at,invested,value,manual_count,pending_count)
 SELECT i.user_id,date_trunc('hour',now())+make_interval(mins=>(extract(minute FROM now())::int/30)*30),clock_timestamp(),
 coalesce(sum(i.invested_amount) FILTER(WHERE i.status<>'resgatado'),0),
 coalesce(sum(CASE WHEN t.quantity=0 THEN 0 WHEN t.id IS NOT NULL AND q.price IS NOT NULL THEN round(t.quantity*q.price,2) ELSE i.current_amount END) FILTER(WHERE i.status<>'resgatado'),0),
 count(*) FILTER(WHERE i.status<>'resgatado' AND t.id IS NULL),count(*) FILTER(WHERE i.status<>'resgatado' AND t.id IS NOT NULL AND q.price IS NULL)
 FROM public.investments i LEFT JOIN public.investment_tracking t ON t.investment_id=i.id AND t.user_id=i.user_id
 LEFT JOIN private.investment_quotes q ON q.provider=t.provider AND q.asset_code=t.asset_code GROUP BY i.user_id
 ON CONFLICT(user_id,bucket) DO UPDATE SET captured_at=excluded.captured_at,invested=excluded.invested,value=excluded.value,
 manual_count=excluded.manual_count,pending_count=excluded.pending_count;
 DELETE FROM private.investment_valuation_history WHERE bucket<now()-interval '180 days';
END $$;
REVOKE ALL ON FUNCTION private.capture_investment_valuations() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('private.collect_investment_quotes()'::regprocedure),
 ' RETURN accepted;',' PERFORM private.capture_investment_valuations();'||chr(10)||' RETURN accepted;');
END $$;
CREATE FUNCTION public.get_investment_valuation_history() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY captured_at),'[]') FROM (
 SELECT DISTINCT ON ((captured_at AT TIME ZONE 'America/Sao_Paulo')::date) captured_at,invested,value,manual_count,pending_count
 FROM private.investment_valuation_history WHERE user_id=public.space_owner(auth.uid()) AND captured_at>=now()-interval '90 days'
 ORDER BY (captured_at AT TIME ZONE 'America/Sao_Paulo')::date,captured_at DESC LIMIT 90)h;
$$;
REVOKE ALL ON FUNCTION public.get_investment_valuation_history() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_investment_valuation_history() TO authenticated;
SELECT private.capture_investment_valuations();
