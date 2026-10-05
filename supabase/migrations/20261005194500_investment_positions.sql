-- Objetivo: separar posicoes cotadas do cadastro e consolidar a Carteira Global.
-- Tabelas afetadas: investment_tracking, investments, investment_events, historico e cache privado.
-- Impacto de dados: nenhum backfill. Cadastros anteriores continuam manuais.
-- RLS: leitura do titular/espectador, escrita somente pelas RPCs de administrador.
-- Indices/FKs: posicao unica por investimento, FK CASCADE e indice de cotacao compartilhada.
-- Rollback: voltar frontend, desativar cron, remover RPCs novas e restaurar overview anterior.
CREATE TABLE public.investment_tracking (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 investment_id uuid NOT NULL UNIQUE REFERENCES public.investments(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('brapi','coingecko')),
 asset_code text NOT NULL CHECK(length(asset_code) BETWEEN 1 AND 80 AND asset_code ~ '^[a-zA-Z0-9.-]+$'),
 quantity numeric(28,12) NOT NULL CHECK(quantity>=0 AND quantity<1e15),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX investment_tracking_quote ON public.investment_tracking(provider,asset_code);
ALTER TABLE public.investment_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_tracking FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.investment_tracking TO authenticated;
GRANT ALL ON public.investment_tracking TO service_role;
CREATE POLICY position_read ON public.investment_tracking FOR SELECT TO authenticated
 USING(user_id=(SELECT public.space_owner((SELECT auth.uid()))));
CREATE TABLE private.investment_quotes (
 provider text NOT NULL, asset_code text NOT NULL, price numeric, quoted_at timestamptz,
 checked_at timestamptz, attempted_at timestamptz, error text, PRIMARY KEY(provider,asset_code)
);
CREATE TABLE private.investment_quote_history (
 provider text NOT NULL,asset_code text NOT NULL,quoted_at timestamptz NOT NULL,price numeric NOT NULL,
 PRIMARY KEY(provider,asset_code,quoted_at)
);
CREATE TABLE private.investment_quote_requests (
 request_id bigint PRIMARY KEY,provider text NOT NULL,asset_code text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,status text NOT NULL DEFAULT 'pending'
);
CREATE INDEX investment_requests_pending ON private.investment_quote_requests(created_at) WHERE finished_at IS NULL;
CREATE TABLE private.investment_credentials (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('brapi','coingecko')),secret_id uuid NOT NULL,
 PRIMARY KEY(user_id,provider)
);
REVOKE ALL ON private.investment_quotes,private.investment_quote_history,private.investment_quote_requests,private.investment_credentials FROM PUBLIC,anon,authenticated;
-- Sem alterar snapshots antigos das tabelas ja monitoradas.
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('private.history_tables()'::regprocedure),
   $x$'ocr_import_receipts'$x$,$x$'ocr_import_receipts','investment_tracking'$x$);
 EXECUTE replace(pg_get_functiondef('private.history_restore_order(text)'::regprocedure),
   $x$WHEN 'investment_events' THEN 40$x$,$x$WHEN 'investment_tracking' THEN 20 WHEN 'investment_events' THEN 40$x$);
END $$;
CREATE TRIGGER zz_history_capture AFTER INSERT OR UPDATE OR DELETE ON public.investment_tracking
 FOR EACH ROW EXECUTE FUNCTION private.capture_financial_action();

CREATE FUNCTION public.get_investment_portfolio() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 WITH rows AS (
 SELECT to_jsonb(i)||jsonb_build_object(
   'book_amount',i.current_amount,'provider',coalesce(t.provider,'manual'),'asset_code',t.asset_code,
   'quantity',t.quantity,'unit_price',q.price,'quoted_at',q.quoted_at,'checked_at',q.checked_at,
   'quote_error',q.error,'current_amount',CASE WHEN t.quantity=0 THEN 0 WHEN t.id IS NOT NULL AND q.price IS NOT NULL THEN round(t.quantity*q.price,2) ELSE i.current_amount END,
   'valuation_status',CASE WHEN t.id IS NULL THEN 'manual' WHEN q.price IS NULL THEN 'pending'
      WHEN q.error IS NOT NULL THEN 'error' WHEN q.checked_at<now()-interval '65 minutes' OR (t.provider='coingecko' AND q.quoted_at<now()-interval '2 hours') OR (t.provider='brapi' AND q.quoted_at<now()-interval '96 hours') THEN 'stale' ELSE 'quoted' END
 ) AS row,
 i.status,i.invested_amount,CASE WHEN t.quantity=0 THEN 0 WHEN t.id IS NOT NULL AND q.price IS NOT NULL THEN round(t.quantity*q.price,2) ELSE i.current_amount END AS value,
 i.name,i.is_emergency_reserve,i.applied_at,t.id AS tracking_id,q.price
 FROM public.investments i LEFT JOIN public.investment_tracking t ON t.investment_id=i.id AND t.user_id=i.user_id
 LEFT JOIN private.investment_quotes q ON q.provider=t.provider AND q.asset_code=t.asset_code
 WHERE i.user_id=public.space_owner(auth.uid())
 ), active AS (SELECT * FROM rows WHERE status<>'resgatado'),
 totals AS (SELECT coalesce(sum(invested_amount),0) AS invested,coalesce(sum(value),0) AS value,
 coalesce(sum(value) FILTER(WHERE is_emergency_reserve),0) AS reserve,
 coalesce(sum((value-invested_amount)/greatest(1,(CURRENT_DATE-applied_at)::numeric/30)),0) AS monthly_average,
 count(*) FILTER(WHERE tracking_id IS NULL) AS manual_count,
 count(*) FILTER(WHERE tracking_id IS NOT NULL AND price IS NULL) AS pending_count FROM active)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(row ORDER BY row->>'created_at' DESC) FROM rows),'[]'),
 'summary',jsonb_build_object('invested',invested,'value',value,'profit',value-invested,
 'profit_pct',CASE WHEN invested>0 THEN (value-invested)/invested*100 ELSE 0 END,'reserve',reserve,'monthly_average',monthly_average,
 'manual_count',manual_count,'pending_count',pending_count,
 'highest',(SELECT jsonb_build_object('name',name,'profit',value-invested_amount) FROM active ORDER BY value-invested_amount DESC LIMIT 1),
 'lowest',(SELECT jsonb_build_object('name',name,'profit',value-invested_amount) FROM active ORDER BY value-invested_amount ASC LIMIT 1))) FROM totals;
$$;
CREATE FUNCTION public.save_investment_position(p_id uuid,p_details jsonb,p_provider text DEFAULT 'manual',p_asset_code text DEFAULT NULL,p_quantity numeric DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); iid uuid:=p_id; code text;
BEGIN
 IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('manual','brapi','coingecko') THEN RAISE EXCEPTION 'Fonte invalida'; END IF;
 IF p_provider<>'manual' THEN
   code:=CASE WHEN p_provider='brapi' THEN upper(trim(p_asset_code)) ELSE lower(trim(p_asset_code)) END;
   IF code IS NULL OR code !~ '^[a-zA-Z0-9.-]{1,80}$' OR p_quantity IS NULL OR p_quantity<0 OR (p_quantity>0 AND round(p_quantity,12)=0) OR p_quantity>=1e15 OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Identificador ou quantidade invalida'; END IF;
   IF p_provider='brapi' AND p_details->>'inv_type' NOT IN ('acoes','fiis','outros') THEN RAISE EXCEPTION 'Cotacao B3 requer acao, FII ou outro ativo negociado'; END IF;
   IF p_provider='coingecko' AND p_details->>'inv_type'<>'cripto' THEN RAISE EXCEPTION 'CoinGecko requer criptomoeda'; END IF;
 END IF;
 IF nullif(trim(p_details->>'name'),'') IS NULL OR (p_details->>'invested_amount')::numeric IS NULL OR
 (p_details->>'current_amount')::numeric IS NULL OR (p_details->>'initial_amount')::numeric IS NULL OR
 (p_details->>'invested_amount')::numeric<0 OR (p_details->>'current_amount')::numeric<0 OR (p_details->>'initial_amount')::numeric<0 OR
 p_details->>'invested_amount' IN ('NaN','Infinity','-Infinity') OR p_details->>'current_amount' IN ('NaN','Infinity','-Infinity') OR p_details->>'initial_amount' IN ('NaN','Infinity','-Infinity') OR
 p_details->>'status' NOT IN ('ativo','pausado','resgatado') THEN RAISE EXCEPTION 'Dados invalidos'; END IF;
 IF iid IS NULL THEN
  INSERT INTO public.investments(user_id,name,inv_type,institution,invested_amount,current_amount,initial_amount,applied_at,maturity_date,liquidity,risk,objective,notes,status,is_emergency_reserve,color)
  VALUES(uid,trim(p_details->>'name'),p_details->>'inv_type',p_details->>'institution',(p_details->>'invested_amount')::numeric,
  (p_details->>'current_amount')::numeric,(p_details->>'initial_amount')::numeric,(p_details->>'applied_at')::date,
  (p_details->>'maturity_date')::date,p_details->>'liquidity',p_details->>'risk',p_details->>'objective',p_details->>'notes',p_details->>'status',
  coalesce((p_details->>'is_emergency_reserve')::boolean,false),p_details->>'color') RETURNING id INTO iid;
 ELSE
  PERFORM public.update_investment_details(iid,trim(p_details->>'name'),p_details->>'inv_type',p_details->>'institution',
   (p_details->>'invested_amount')::numeric,(p_details->>'current_amount')::numeric,(p_details->>'initial_amount')::numeric,
   (p_details->>'applied_at')::date,(p_details->>'maturity_date')::date,p_details->>'liquidity',p_details->>'risk',p_details->>'objective',
   p_details->>'notes',p_details->>'status',coalesce((p_details->>'is_emergency_reserve')::boolean,false),p_details->>'color');
 END IF;
 IF p_provider='manual' THEN DELETE FROM public.investment_tracking WHERE investment_id=iid AND user_id=uid;
 ELSE
  INSERT INTO public.investment_tracking(investment_id,user_id,provider,asset_code,quantity) VALUES(iid,uid,p_provider,code,p_quantity)
  ON CONFLICT(investment_id) DO UPDATE SET provider=excluded.provider,asset_code=excluded.asset_code,quantity=excluded.quantity;
 END IF;
 RETURN iid;
END $$;
CREATE FUNCTION public.invest_move_position(p_id uuid,p_kind text,p_amount numeric,p_date date,p_account_id uuid,p_units numeric DEFAULT NULL,p_notes text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); inv public.investments%ROWTYPE; pos public.investment_tracking%ROWTYPE; tx uuid; cost numeric; current_value numeric; fraction numeric;
BEGIN
 IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('aporte','resgate') OR p_amount IS NULL OR p_amount<=0 OR p_amount>=1e15 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_date IS NULL THEN RAISE EXCEPTION 'Movimentacao invalida'; END IF;
 SELECT * INTO inv FROM public.investments WHERE id=p_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Investimento nao encontrado'; END IF;
 IF p_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND user_id=uid AND type NOT IN ('investment','credit_card')) THEN RAISE EXCEPTION 'Selecione uma conta de origem ou destino'; END IF;
 SELECT * INTO pos FROM public.investment_tracking WHERE investment_id=p_id AND user_id=uid FOR UPDATE;
 current_value:=inv.current_amount;
 IF pos.id IS NOT NULL THEN
  IF p_units IS NULL OR p_units<=0 OR round(p_units,12)=0 OR p_units>=1e15 OR p_units::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Informe a quantidade negociada'; END IF;
  IF p_kind='resgate' AND p_units>pos.quantity THEN RAISE EXCEPTION 'Quantidade maior que a posicao'; END IF;
  fraction:=CASE WHEN p_kind='resgate' THEN p_units/nullif(pos.quantity,0) ELSE 0 END;
 ELSE
  IF p_kind='resgate' AND p_amount>current_value THEN RAISE EXCEPTION 'Valor maior que o disponivel'; END IF;
  fraction:=CASE WHEN p_kind='resgate' THEN p_amount/nullif(current_value,0) ELSE 0 END;
 END IF;
 cost:=CASE WHEN p_kind='resgate' THEN inv.invested_amount*coalesce(fraction,0) ELSE 0 END;
 INSERT INTO public.transactions(user_id,amount,type,flow,description,occurred_at,account_id)
 VALUES(uid,p_amount,CASE WHEN p_kind='aporte' THEN 'expense' ELSE 'income' END,
 CASE WHEN p_kind='aporte' THEN 'contribution' ELSE 'redemption' END,
 CASE WHEN p_kind='aporte' THEN 'Aporte: ' ELSE 'Resgate: ' END||inv.name,p_date,p_account_id) RETURNING id INTO tx;
 UPDATE public.investments SET invested_amount=CASE WHEN p_kind='aporte' THEN invested_amount+p_amount ELSE greatest(0,invested_amount-cost) END,
 current_amount=CASE WHEN p_kind='aporte' THEN current_amount+p_amount ELSE greatest(0,current_amount*(1-coalesce(fraction,0))) END,
 status=CASE WHEN p_kind='resgate' AND fraction=1 THEN 'resgatado' ELSE 'ativo' END WHERE id=p_id;
 IF pos.id IS NOT NULL THEN
  UPDATE public.investment_tracking SET quantity=quantity+CASE WHEN p_kind='aporte' THEN p_units ELSE -p_units END WHERE id=pos.id;
 END IF;
 INSERT INTO public.investment_events(user_id,investment_id,event_type,amount,occurred_at,account_id,transaction_id,notes)
 VALUES(uid,p_id,p_kind,p_amount,p_date,p_account_id,tx,p_notes);
 RETURN tx;
END $$;
-- Clientes antigos nao podem movimentar posicoes cotadas sem informar unidades.
DO $$ DECLARE f regprocedure; body text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.invest_contribute(uuid,numeric,date,uuid,text)'::regprocedure,
 'public.invest_redeem(uuid,numeric,date,uuid,text)'::regprocedure,'public.invest_update_value(uuid,numeric,text)'::regprocedure] LOOP
 body:=pg_get_functiondef(f);
 body:=regexp_replace(body,'\mBEGIN\M',$guard$BEGIN
 IF EXISTS(SELECT 1 FROM public.investment_tracking WHERE investment_id=p_investment_id) THEN RAISE EXCEPTION 'Use a movimentacao com quantidade para posicoes cotadas'; END IF;$guard$,'i');
 EXECUTE body;
 END LOOP;
END $$;
CREATE FUNCTION public.get_global_wallet() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 WITH overview AS (SELECT public.get_financial_overview() AS v), portfolio AS (SELECT public.get_investment_portfolio()->'summary' AS s)
 SELECT jsonb_build_object('overview',v,'investment_summary',s,
 'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.get_account_balances() a),'[]'),
 'unassigned_balance',(v->>'saldo_disponivel')::numeric-coalesce((SELECT sum(balance) FROM public.get_account_balances()),0),
 'net_worth',(v->>'patrimonio_total')::numeric-(v->>'faturas_abertas')::numeric) FROM overview,portfolio;
$$;
CREATE FUNCTION public.get_investment_price_history(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.quoted_at),'[]') FROM (
 SELECT DISTINCT ON ((q.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date) q.quoted_at,q.price
 FROM private.investment_quote_history q JOIN public.investment_tracking t ON t.provider=q.provider AND t.asset_code=q.asset_code
 WHERE t.investment_id=p_id AND t.user_id=public.space_owner(auth.uid()) AND q.quoted_at>=now()-interval '90 days'
 ORDER BY (q.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date,q.quoted_at DESC LIMIT 90) h;
$$;
REVOKE ALL ON FUNCTION public.get_investment_portfolio(),public.save_investment_position(uuid,jsonb,text,text,numeric),public.invest_move_position(uuid,text,numeric,date,uuid,numeric,text),public.get_global_wallet(),public.get_investment_price_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_investment_portfolio(),public.save_investment_position(uuid,jsonb,text,text,numeric),public.invest_move_position(uuid,text,numeric,date,uuid,numeric,text),public.get_global_wallet(),public.get_investment_price_history(uuid) TO authenticated;
