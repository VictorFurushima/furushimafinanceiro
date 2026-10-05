-- Objetivo: buscar cotacoes reais a cada 30 minutos e consumir respostas sem bloquear o cliente.
-- Tabelas afetadas: caches/requests/credenciais privados, Vault e cron.job.
-- Impacto de dados: nenhuma alteracao em dinheiro ou quantidade. Sem consulta a bancos pessoais.
-- RLS: RPCs somente authenticated, configuracao/sincronizacao somente administrador.
-- Indices/FKs: cache por fonte+ativo, chave criptografada por usuario no Vault.
-- Rollback: cron.unschedule dos dois jobs investment-quotes, revogar/remover RPCs.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
REVOKE USAGE ON SCHEMA net FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.configure_investment_provider(p_provider text,p_token text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); sid uuid;
BEGIN
 IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('brapi','coingecko') THEN RAISE EXCEPTION 'Fonte invalida'; END IF;
 IF p_token IS NULL OR length(p_token)>500 OR p_token ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Chave invalida'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||p_provider,0));
 SELECT secret_id INTO sid FROM private.investment_credentials WHERE user_id=uid AND provider=p_provider;
 IF trim(p_token)='' THEN
  DELETE FROM private.investment_credentials WHERE user_id=uid AND provider=p_provider;
  IF sid IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=sid; END IF;
 ELSIF sid IS NULL THEN
  sid:=vault.create_secret(trim(p_token),'investment:'||uid||':'||p_provider,'Cotacoes de investimentos');
  INSERT INTO private.investment_credentials VALUES(uid,p_provider,sid);
 ELSE PERFORM vault.update_secret(sid,trim(p_token));
 END IF;
 UPDATE private.investment_quotes q SET attempted_at=NULL WHERE q.provider=p_provider AND q.error='Configure a chave da fonte para este ativo' AND EXISTS(SELECT 1 FROM public.investment_tracking t WHERE t.user_id=uid AND t.provider=q.provider AND t.asset_code=q.asset_code);
END $$;
CREATE FUNCTION public.get_investment_provider_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT jsonb_build_object('brapi',EXISTS(SELECT 1 FROM private.investment_credentials WHERE user_id=public.space_owner(auth.uid()) AND provider='brapi'),
 'coingecko',EXISTS(SELECT 1 FROM private.investment_credentials WHERE user_id=public.space_owner(auth.uid()) AND provider='coingecko'));
$$;
CREATE FUNCTION private.accept_investment_quote(p_provider text,p_code text,p_price numeric,p_quoted_at timestamptz) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
 IF p_price IS NULL OR p_price<=0 OR p_price>=1e15 OR p_price::text IN ('NaN','Infinity','-Infinity') OR p_quoted_at IS NULL OR p_quoted_at>clock_timestamp()+interval '5 minutes' OR p_quoted_at<clock_timestamp()-interval '14 days' THEN RAISE EXCEPTION 'Cotacao invalida'; END IF;
 UPDATE private.investment_quotes SET price=p_price,quoted_at=p_quoted_at,checked_at=clock_timestamp(),error=NULL
 WHERE provider=p_provider AND asset_code=p_code AND (quoted_at IS NULL OR quoted_at<=p_quoted_at);
 IF FOUND THEN
  INSERT INTO private.investment_quote_history VALUES(p_provider,p_code,p_quoted_at,p_price) ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION private.collect_investment_quotes() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE r record; response record; payload jsonb; item jsonb; price numeric; stamp timestamptz; accepted integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(195051947) THEN RETURN 0; END IF;
 FOR r IN SELECT * FROM private.investment_quote_requests WHERE finished_at IS NULL ORDER BY created_at LIMIT 100 LOOP
  SELECT * INTO response FROM net._http_response WHERE id=r.request_id;
  IF NOT FOUND AND r.created_at>clock_timestamp()-interval '5 minutes' THEN CONTINUE; END IF;
  BEGIN
   IF response.id IS NULL OR response.status_code<>200 OR coalesce(response.timed_out,false) THEN
    RAISE EXCEPTION 'Resposta indisponivel';
   END IF;
   payload:=response.content::jsonb;
   IF r.provider='brapi' THEN
    SELECT v INTO item FROM jsonb_array_elements(payload->'results') v WHERE coalesce(v->>'requestedSymbol',v->>'symbol')=r.asset_code LIMIT 1;
    item:=coalesce(item->'data',item);
    IF item->>'currency'<>'BRL' THEN RAISE EXCEPTION 'Moeda inesperada'; END IF;
    price:=(item->>'regularMarketPrice')::numeric;
    stamp:=CASE WHEN jsonb_typeof(item->'regularMarketTime')='number' THEN to_timestamp((item->>'regularMarketTime')::double precision) ELSE (item->>'regularMarketTime')::timestamptz END;
   ELSE
    item:=payload->r.asset_code;price:=(item->>'brl')::numeric;stamp:=to_timestamp((item->>'last_updated_at')::double precision);
   END IF;
   PERFORM private.accept_investment_quote(r.provider,r.asset_code,price,stamp);
   UPDATE private.investment_quote_requests SET status='ok',finished_at=clock_timestamp() WHERE request_id=r.request_id;
   accepted:=accepted+1;
  EXCEPTION WHEN OTHERS THEN
   UPDATE private.investment_quotes SET error=CASE response.status_code WHEN 401 THEN 'Chave ausente ou invalida' WHEN 403 THEN 'Ativo nao incluido no plano da fonte' WHEN 429 THEN 'Limite da fonte atingido' ELSE 'Fonte indisponivel ou cotacao invalida' END WHERE provider=r.provider AND asset_code=r.asset_code;
   UPDATE private.investment_quote_requests SET status='error',finished_at=clock_timestamp() WHERE request_id=r.request_id;
  END;
 END LOOP;
 DELETE FROM private.investment_quote_requests WHERE finished_at<clock_timestamp()-interval '7 days';
 DELETE FROM private.investment_quote_history WHERE quoted_at<clock_timestamp()-interval '180 days';
 RETURN accepted;
END $$;
CREATE FUNCTION private.queue_investment_quotes(p_user_id uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE r record; token text; rid bigint; headers jsonb; queued integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(195051948) THEN RETURN 0; END IF;
 FOR r IN SELECT DISTINCT t.provider,t.asset_code FROM public.investment_tracking t JOIN public.investments i ON i.id=t.investment_id
 WHERE i.status='ativo' AND t.quantity>0 AND (p_user_id IS NULL OR t.user_id=p_user_id) ORDER BY t.provider,t.asset_code LOOP
  EXIT WHEN queued>=100;
  INSERT INTO private.investment_quotes(provider,asset_code) VALUES(r.provider,r.asset_code) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM private.investment_quotes WHERE provider=r.provider AND asset_code=r.asset_code AND attempted_at>clock_timestamp()-interval '30 minutes') THEN CONTINUE; END IF;
  SELECT s.decrypted_secret INTO token FROM private.investment_credentials c JOIN vault.decrypted_secrets s ON s.id=c.secret_id
  WHERE c.provider=r.provider AND EXISTS(SELECT 1 FROM public.investment_tracking t WHERE t.provider=r.provider AND t.asset_code=r.asset_code AND t.user_id=c.user_id AND (p_user_id IS NULL OR t.user_id=p_user_id)) LIMIT 1;
  UPDATE private.investment_quotes SET attempted_at=clock_timestamp() WHERE provider=r.provider AND asset_code=r.asset_code;
  IF token IS NULL AND (r.provider='coingecko' OR r.asset_code NOT IN ('PETR4','VALE3','ITUB4','MGLU3')) THEN
   UPDATE private.investment_quotes SET error='Configure a chave da fonte para este ativo' WHERE provider=r.provider AND asset_code=r.asset_code;
   CONTINUE;
  END IF;
  headers:=CASE WHEN token IS NULL THEN '{}'::jsonb WHEN r.provider='brapi' THEN jsonb_build_object('Authorization','Bearer '||token) ELSE jsonb_build_object('x-cg-demo-api-key',token) END;
  IF r.provider='brapi' THEN
   rid:=net.http_get('https://brapi.dev/api/v2/stocks/quote',jsonb_build_object('symbols',r.asset_code),headers,10000);
  ELSE
   rid:=net.http_get('https://api.coingecko.com/api/v3/simple/price',jsonb_build_object('ids',r.asset_code,'vs_currencies','brl','include_last_updated_at','true'),headers,10000);
  END IF;
  INSERT INTO private.investment_quote_requests(request_id,provider,asset_code) VALUES(rid,r.provider,r.asset_code);
  queued:=queued+1;
 END LOOP;
 RETURN queued;
END $$;
CREATE FUNCTION public.refresh_investment_quotes() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); processed integer; queued integer;
BEGIN
 IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
 processed:=private.collect_investment_quotes();queued:=private.queue_investment_quotes(uid);
 RETURN jsonb_build_object('queued',queued,'processed',processed,'interval_minutes',30);
END $$;
REVOKE ALL ON FUNCTION private.accept_investment_quote(text,text,numeric,timestamptz),private.collect_investment_quotes(),private.queue_investment_quotes(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.configure_investment_provider(text,text),public.get_investment_provider_status(),public.refresh_investment_quotes() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_investment_provider(text,text),public.get_investment_provider_status(),public.refresh_investment_quotes() TO authenticated;
SELECT cron.schedule('investment-quotes-30min','*/30 * * * *','SELECT private.queue_investment_quotes();');
SELECT cron.schedule('investment-quotes-collect','*/2 * * * *','SELECT private.collect_investment_quotes();');
