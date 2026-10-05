-- Objetivo: historico financeiro persistente com reversao atomica e verificacao de conflitos.
-- Tabelas afetadas: financial_actions, financial_action_changes e tabelas financeiras monitoradas.
-- Impacto de dados: sem backfill; captura apenas novas alteracoes autenticadas de administradores.
-- RLS: historico visivel ao espaco; escrita direta proibida; reversao somente pelo titular admin.
-- Indices/FKs: historico por titular/tempo, grupo por transacao, snapshots por registro.
-- Rollback: retirar triggers history_capture e RPCs; restaurar funcoes guardadas em private.history_trigger_backups.

CREATE TABLE public.financial_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 transaction_key bigint NOT NULL,
 root_table text NOT NULL,
 root_operation text NOT NULL CHECK(root_operation IN ('INSERT','UPDATE','DELETE')),
 root_depth int NOT NULL,
 description text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reverted_at timestamptz,
 reversal_id uuid,
 reversal_of uuid REFERENCES public.financial_actions(id) ON DELETE SET NULL,
 UNIQUE(user_id,transaction_key)
);
CREATE INDEX financial_actions_owner_time ON public.financial_actions(user_id,created_at DESC,id);
CREATE TABLE public.financial_action_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 action_id uuid NOT NULL REFERENCES public.financial_actions(id) ON DELETE CASCADE,
 table_name text NOT NULL,
 record_id uuid NOT NULL,
 before_row jsonb,
 after_row jsonb,
 UNIQUE(action_id,table_name,record_id)
);
CREATE INDEX financial_changes_record ON public.financial_action_changes(table_name,record_id,action_id);
ALTER TABLE public.financial_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_action_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_actions,public.financial_action_changes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.financial_actions,public.financial_action_changes TO authenticated;
GRANT ALL ON public.financial_actions,public.financial_action_changes TO service_role;
CREATE POLICY financial_history_read ON public.financial_actions FOR SELECT TO authenticated
 USING(user_id=(SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY financial_history_changes_read ON public.financial_action_changes FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.financial_actions a WHERE a.id=action_id AND a.user_id=(SELECT public.space_owner((SELECT auth.uid())))));

CREATE TABLE private.history_replay_context (
 transaction_key bigint PRIMARY KEY, actor_id uuid NOT NULL, action_id uuid NOT NULL
);
CREATE TABLE private.history_trigger_backups (
 function_oid oid PRIMARY KEY, function_definition text NOT NULL
);
REVOKE ALL ON private.history_replay_context,private.history_trigger_backups FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.history_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT ARRAY['accounts','categories','budgets','category_limits','credit_cards','credit_card_bills',
 'credit_card_bill_items','transactions','recurring_expenses','balance_recharges','goals','investments',
 'investment_events','shopping_items','user_settings','profiles','uploaded_transaction_images',
 'ocr_detected_transactions','ocr_import_receipts']::text[]
$$;
CREATE FUNCTION private.history_replay_active() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM private.history_replay_context WHERE transaction_key=txid_current() AND actor_id=auth.uid())
$$;
REVOKE ALL ON FUNCTION private.history_tables(),private.history_replay_active() FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.history_replay_active() TO authenticated;

CREATE FUNCTION private.capture_financial_action() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); b jsonb; a jsonb; rowid uuid; ownerid uuid; aid uuid; depth int:=pg_trigger_depth();
 rootdesc text;
BEGIN
 IF uid IS NULL OR NOT public.is_admin(uid) OR private.history_replay_active() THEN RETURN NULL; END IF;
 IF NOT TG_TABLE_NAME=ANY(private.history_tables()) THEN RAISE EXCEPTION 'Tabela fora do historico'; END IF;
 IF TG_OP<>'INSERT' THEN b:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN a:=to_jsonb(NEW); END IF;
 IF b IS NOT DISTINCT FROM a THEN RETURN NULL; END IF;
 rowid:=coalesce(a->>'id',a->>'user_id',b->>'id',b->>'user_id')::uuid;
 ownerid:=CASE WHEN TG_TABLE_NAME='profiles' THEN coalesce(a->>'id',b->>'id')::uuid
   ELSE coalesce(a->>'user_id',b->>'user_id')::uuid END;
 IF ownerid<>uid THEN RAISE EXCEPTION 'Historico pertence a outro titular'; END IF;
 rootdesc:=left(coalesce(a->>'description',b->>'description',a->>'name',b->>'name',a->>'item',b->>'item',a->>'event_type',b->>'event_type',a->>'file_name',b->>'file_name'),300);
 INSERT INTO public.financial_actions(user_id,transaction_key,root_table,root_operation,root_depth,description)
 VALUES(uid,txid_current(),TG_TABLE_NAME,TG_OP,depth,rootdesc)
 ON CONFLICT(user_id,transaction_key) DO UPDATE SET
 root_table=CASE WHEN excluded.root_depth<=financial_actions.root_depth THEN excluded.root_table ELSE financial_actions.root_table END,
 root_operation=CASE WHEN excluded.root_depth<=financial_actions.root_depth THEN excluded.root_operation ELSE financial_actions.root_operation END,
 description=CASE WHEN excluded.root_depth<=financial_actions.root_depth THEN excluded.description ELSE financial_actions.description END,
 root_depth=least(excluded.root_depth,financial_actions.root_depth)
 RETURNING id INTO aid;
 INSERT INTO public.financial_action_changes(action_id,table_name,record_id,before_row,after_row)
 VALUES(aid,TG_TABLE_NAME,rowid,b,a)
 ON CONFLICT(action_id,table_name,record_id) DO UPDATE SET after_row=excluded.after_row;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.capture_financial_action() FROM PUBLIC,anon,authenticated;

-- O contexto de replay fica em tabela privada e so a RPC autorizada consegue ativa-lo.
-- Durante a restauracao, nao regenerar parcelas, limites, timestamps ou validacoes intermediarias.
-- As constraints e a verificacao final continuam obrigatorias; escrita normal mantem todos os triggers.
DO $$
DECLARE f record; body text; definition text; t text;
BEGIN
 FOR f IN SELECT DISTINCT p.oid,p.prosrc FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=tr.tgfoid
  JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND c.relname=ANY(private.history_tables()) AND NOT tr.tgisinternal
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=f.oid AND l.lanname='plpgsql') THEN
   RAISE EXCEPTION 'Trigger nao compativel com historico: %',f.oid; END IF;
  INSERT INTO private.history_trigger_backups VALUES(f.oid,pg_get_functiondef(f.oid));
  body:=regexp_replace(f.prosrc,'\mBEGIN\M',E'BEGIN\n IF private.history_replay_active() THEN\n  IF TG_OP=\'DELETE\' THEN RETURN OLD; ELSE RETURN NEW; END IF;\n END IF;','i');
  IF body=f.prosrc THEN RAISE EXCEPTION 'Corpo de trigger nao reconhecido'; END IF;
  definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);
  EXECUTE definition;
 END LOOP;
 FOREACH t IN ARRAY private.history_tables() LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Tabela financeira ausente: %',t; END IF;
  EXECUTE format('CREATE TRIGGER zz_history_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.capture_financial_action()',t);
 END LOOP;
END $$;

CREATE FUNCTION private.history_record_key(p_table text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_table='user_settings' THEN 'user_id' ELSE 'id' END
$$;
CREATE FUNCTION private.history_restore_order(p_table text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_table WHEN 'accounts' THEN 10 WHEN 'categories' THEN 10 WHEN 'credit_cards' THEN 10
 WHEN 'investments' THEN 10 WHEN 'uploaded_transaction_images' THEN 10 WHEN 'profiles' THEN 20
 WHEN 'recurring_expenses' THEN 20 WHEN 'goals' THEN 20 WHEN 'credit_card_bills' THEN 20
 WHEN 'budgets' THEN 20 WHEN 'category_limits' THEN 20 WHEN 'user_settings' THEN 20
 WHEN 'transactions' THEN 30 WHEN 'balance_recharges' THEN 40 WHEN 'shopping_items' THEN 40
 WHEN 'investment_events' THEN 40 WHEN 'credit_card_bill_items' THEN 40 WHEN 'ocr_detected_transactions' THEN 40
 WHEN 'ocr_import_receipts' THEN 50 ELSE 100 END
$$;

CREATE FUNCTION private.financial_action_conflicts(p_action_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE r record; fk record; current_row jsonb; issues jsonb:='[]'; key text; related text; source_key text; bad boolean; refvalue uuid; before_parent jsonb; unique_rule record; predicate text;
BEGIN
 FOR r IN SELECT * FROM public.financial_action_changes WHERE action_id=p_action_id ORDER BY table_name,record_id LOOP
  IF r.before_row IS NOT DISTINCT FROM r.after_row THEN CONTINUE; END IF;
  IF NOT r.table_name=ANY(private.history_tables()) THEN RAISE EXCEPTION 'Tabela de historico invalida'; END IF;
  key:=private.history_record_key(r.table_name);
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE %I=$1',r.table_name,key) INTO current_row USING r.record_id;
  IF current_row IS DISTINCT FROM r.after_row THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('table',r.table_name,'id',r.record_id,'reason','Este registro mudou depois desta acao. Reverta primeiro as alteracoes mais recentes.'));
  END IF;
  IF r.table_name='uploaded_transaction_images' THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('table',r.table_name,'id',r.record_id,'reason','Arquivos e leituras de imagens usam o fluxo do importador. A reversao financeira preserva esses arquivos.'));
  END IF;
  -- Impede apagar registros usados por novas operacoes, mesmo com FK CASCADE ou SET NULL.
  IF r.before_row IS NULL THEN
   FOR fk IN SELECT c.conrelid::regclass as source_rel, n.nspname,c2.relname,at.attname as source_column
    FROM pg_constraint c JOIN pg_class c2 ON c2.oid=c.conrelid JOIN pg_namespace n ON n.oid=c2.relnamespace
    JOIN pg_attribute at ON at.attrelid=c.conrelid AND at.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid=('public.'||r.table_name)::regclass AND array_length(c.conkey,1)=1
   LOOP
    source_key:=private.history_record_key(fk.relname);
    IF fk.nspname<>'public' OR NOT fk.relname=ANY(private.history_tables()) THEN
     EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',fk.source_rel,fk.source_column) INTO bad USING r.record_id;
    ELSE
     EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s child WHERE %I=$1 AND NOT EXISTS(SELECT 1 FROM public.financial_action_changes ch WHERE ch.action_id=$2 AND ch.table_name=$3 AND ch.record_id=child.%I))',fk.source_rel,fk.source_column,source_key)
      INTO bad USING r.record_id,p_action_id,fk.relname;
    END IF;
    IF bad THEN issues:=issues||jsonb_build_array(jsonb_build_object('table',r.table_name,'id',r.record_id,'reason','Este registro esta sendo usado por outra operacao. Reverta primeiro essa operacao.')); END IF;
   END LOOP;
  END IF;
  -- Detecta reutilizacao de uma chave unica por outro cadastro antes de restaurar.
  IF r.before_row IS NOT NULL THEN
   FOR unique_rule IN SELECT conkey FROM pg_constraint WHERE conrelid=('public.'||r.table_name)::regclass AND contype='u' LOOP
    SELECT string_agg(format('(to_jsonb(x)->%L)=$1->%L',attname,attname),' AND ') INTO predicate
    FROM pg_attribute WHERE attrelid=('public.'||r.table_name)::regclass AND attnum=ANY(unique_rule.conkey)
      AND r.before_row->attname IS NOT NULL AND r.before_row->attname<>'null'::jsonb;
    IF (SELECT count(*) FROM pg_attribute WHERE attrelid=('public.'||r.table_name)::regclass AND attnum=ANY(unique_rule.conkey)
      AND r.before_row->attname IS NOT NULL AND r.before_row->attname<>'null'::jsonb)<>cardinality(unique_rule.conkey) THEN CONTINUE; END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I x WHERE %I<>$2 AND %s)',r.table_name,key,predicate) INTO bad USING r.before_row,r.record_id;
    IF bad THEN issues:=issues||jsonb_build_array(jsonb_build_object('table',r.table_name,'id',r.record_id,'reason','Outro cadastro ocupa o mesmo periodo ou identificador. Reverta primeiro o cadastro mais recente.')); END IF;
   END LOOP;
  END IF;
  -- Ao restaurar um vinculo antigo, o destino deve existir no mesmo titular ou ser restaurado junto.
  IF r.before_row IS NOT NULL THEN
   FOR fk IN SELECT c.confrelid::regclass as target_rel,n.nspname,p.relname,at.attname as source_column
    FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace n ON n.oid=p.relnamespace
    JOIN pg_attribute at ON at.attrelid=c.conrelid AND at.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.conrelid=('public.'||r.table_name)::regclass AND array_length(c.conkey,1)=1
     AND n.nspname='public' AND p.relname=ANY(private.history_tables())
   LOOP
    refvalue:=nullif(r.before_row->>fk.source_column,'')::uuid;
    IF refvalue IS NULL THEN CONTINUE; END IF;
    SELECT before_row INTO before_parent FROM public.financial_action_changes WHERE action_id=p_action_id AND table_name=fk.relname AND record_id=refvalue;
    IF FOUND THEN
     bad:=before_parent IS NULL;
    ELSE
     EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %s p WHERE %I=$1 AND %I=(SELECT user_id FROM public.financial_actions WHERE id=$2))',fk.target_rel,private.history_record_key(fk.relname),CASE WHEN fk.relname='profiles' THEN 'id' ELSE 'user_id' END)
      INTO bad USING refvalue,p_action_id;
    END IF;
    IF bad THEN issues:=issues||jsonb_build_array(jsonb_build_object('table',r.table_name,'id',r.record_id,'reason','Um vinculo anterior nao esta mais disponivel. Restaure primeiro o cadastro relacionado.')); END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN issues;
END $$;
REVOKE ALL ON FUNCTION private.history_record_key(text),private.history_restore_order(text),private.financial_action_conflicts(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_financial_history(p_page int DEFAULT 0,p_page_size int DEFAULT 25,p_status text DEFAULT 'all',p_table text DEFAULT 'all',p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE owner uuid:=public.space_owner(auth.uid()); result jsonb;
BEGIN
 IF owner IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacao obrigatoria'; END IF;
 IF p_page<0 OR p_page_size NOT BETWEEN 1 AND 50 OR p_status NOT IN ('all','active','reverted') THEN RAISE EXCEPTION 'Filtro de historico invalido'; END IF;
 IF p_table<>'all' AND NOT p_table=ANY(private.history_tables()) THEN RAISE EXCEPTION 'Area invalida'; END IF;
 IF length(p_search)>100 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) THEN RAISE EXCEPTION 'Periodo ou busca invalidos'; END IF;
 WITH filtered AS (
  SELECT a.id,a.root_table,a.root_operation,a.description,a.created_at,a.reverted_at,a.reversal_of,(SELECT count(*) FROM public.financial_action_changes ch WHERE ch.action_id=a.id AND ch.before_row IS DISTINCT FROM ch.after_row) as change_count
  FROM public.financial_actions a WHERE a.user_id=owner
   AND (p_from IS NULL OR (a.created_at AT TIME ZONE 'America/Sao_Paulo')::date>=p_from)
   AND (p_to IS NULL OR (a.created_at AT TIME ZONE 'America/Sao_Paulo')::date<=p_to)
   AND (p_search='' OR a.description ILIKE '%'||p_search||'%')
   AND (p_status='all' OR (p_status='active' AND reverted_at IS NULL) OR (p_status='reverted' AND reverted_at IS NOT NULL))
   AND (p_table='all' OR EXISTS(SELECT 1 FROM public.financial_action_changes ch WHERE ch.action_id=a.id AND ch.table_name=p_table))
 ), page AS (SELECT * FROM filtered WHERE change_count>0 ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET p_page*p_page_size)
 SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered WHERE change_count>0),'rows',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]')) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.get_financial_action(p_action_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE a public.financial_actions; changes jsonb; issues jsonb;
BEGIN
 SELECT * INTO a FROM public.financial_actions WHERE id=p_action_id AND user_id=public.space_owner(auth.uid());
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Acao nao encontrada'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',table_name,'id',record_id,'before',before_row,'after',after_row) ORDER BY private.history_restore_order(table_name),table_name,id),'[]') INTO changes
 FROM public.financial_action_changes WHERE action_id=a.id AND before_row IS DISTINCT FROM after_row;
 issues:=private.financial_action_conflicts(a.id);
 RETURN jsonb_build_object('action',to_jsonb(a),'changes',changes,'conflicts',issues,'can_revert',a.reverted_at IS NULL AND jsonb_array_length(changes)>0 AND jsonb_array_length(issues)=0 AND a.user_id=auth.uid() AND public.is_admin(auth.uid()));
END $$;

CREATE FUNCTION public.revert_financial_action(p_action_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); a public.financial_actions; r record; fk record; locknames text[]; t text;
 issues jsonb; columns text; assignments text; key text; wanted jsonb; current_row jsonb; reversal uuid:=gen_random_uuid();
BEGIN
 IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador titular obrigatorio'; END IF;
 SELECT * INTO a FROM public.financial_actions WHERE id=p_action_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acao nao encontrada'; END IF;
 IF a.reverted_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_reverted','reversal_id',a.reversal_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.financial_action_changes WHERE action_id=a.id AND before_row IS DISTINCT FROM after_row) THEN RAISE EXCEPTION 'Esta acao nao possui alteracoes para reverter'; END IF;
 -- Locks curtos e NOWAIT: nao sobrescrevem outra gravacao nem deixam reversao pela metade.
 SELECT array_agg(DISTINCT name ORDER BY name) INTO locknames FROM (
  SELECT table_name as name FROM public.financial_action_changes WHERE action_id=a.id
  UNION SELECT cl.relname FROM public.financial_action_changes ch JOIN pg_constraint c ON c.confrelid=('public.'||ch.table_name)::regclass AND c.contype='f'
   JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
   WHERE ch.action_id=a.id AND ch.before_row IS NULL AND ns.nspname='public'
 ) lock_tables;
 FOREACH t IN ARRAY locknames LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE NOWAIT',t);
 END LOOP;
 issues:=private.financial_action_conflicts(a.id);
 IF jsonb_array_length(issues)>0 THEN RETURN jsonb_build_object('status','conflict','conflicts',issues); END IF;
 INSERT INTO private.history_replay_context VALUES(txid_current(),uid,a.id);
 -- Deletar primeiro filhos criados pela operacao. Depois restaurar pais e filhos na ordem das FKs.
 FOR r IN SELECT * FROM public.financial_action_changes WHERE action_id=a.id AND before_row IS NULL AND after_row IS NOT NULL
  ORDER BY private.history_restore_order(table_name) DESC,table_name,record_id LOOP
  EXECUTE format('DELETE FROM public.%I WHERE %I=$1',r.table_name,private.history_record_key(r.table_name)) USING r.record_id;
 END LOOP;
 FOR r IN SELECT table_name,jsonb_agg(before_row) as snapshots FROM public.financial_action_changes
  WHERE action_id=a.id AND before_row IS NOT NULL AND before_row IS DISTINCT FROM after_row
  GROUP BY table_name ORDER BY private.history_restore_order(table_name),table_name LOOP
  key:=private.history_record_key(r.table_name);
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum),
   string_agg(format('%I=excluded.%I',attname,attname),',' ORDER BY attnum) FILTER(WHERE attname<>key)
   INTO columns,assignments FROM pg_attribute WHERE attrelid=('public.'||r.table_name)::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='';
  EXECUTE format('INSERT INTO public.%I(%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I,$1) ON CONFLICT(%I) DO UPDATE SET %s',r.table_name,columns,columns,r.table_name,key,assignments) USING r.snapshots;
 END LOOP;
 -- Exactitude final: se um cascade ou uma constraint impedir o estado original, rollback integral.
 FOR r IN SELECT * FROM public.financial_action_changes WHERE action_id=a.id LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE %I=$1',r.table_name,private.history_record_key(r.table_name)) INTO current_row USING r.record_id;
  IF current_row IS DISTINCT FROM r.before_row THEN RAISE EXCEPTION 'Nao foi possivel restaurar a operacao integralmente'; END IF;
 END LOOP;
 DELETE FROM private.history_replay_context WHERE transaction_key=txid_current();
 -- A propria reversao e uma acao registrada: permite desfazer uma reversao por engano.
 INSERT INTO public.financial_actions(id,user_id,transaction_key,root_table,root_operation,root_depth,description,reversal_of)
 VALUES(reversal,uid,txid_current(),a.root_table,CASE a.root_operation WHEN 'INSERT' THEN 'DELETE' WHEN 'DELETE' THEN 'INSERT' ELSE 'UPDATE' END,1,a.description,a.id);
 INSERT INTO public.financial_action_changes(action_id,table_name,record_id,before_row,after_row)
 SELECT reversal,table_name,record_id,after_row,before_row FROM public.financial_action_changes WHERE action_id=a.id;
 UPDATE public.financial_actions SET reverted_at=clock_timestamp(),reversal_id=reversal WHERE id=a.id;
 RETURN jsonb_build_object('status','reverted','reversal_id',reversal);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'Outra gravacao esta em andamento. Aguarde e tente reverter novamente.';
END $$;
REVOKE ALL ON FUNCTION public.get_financial_history(int,int,text,text,date,date,text),public.get_financial_action(uuid),public.revert_financial_action(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_financial_history(int,int,text,text,date,date,text),public.get_financial_action(uuid),public.revert_financial_action(uuid) TO authenticated;
