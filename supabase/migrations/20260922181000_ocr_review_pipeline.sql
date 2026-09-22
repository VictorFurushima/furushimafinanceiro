-- Objetivo: revisao persistente, hash de arquivo, leitura atomica e deteccao de duplicatas.
-- Tabelas afetadas: uploaded_transaction_images, ocr_detected_transactions.
-- Impacto de dados: preserva registros e atribui source_key aos itens legados.
-- RLS: preservada; todas as RPCs exigem escopo e escritas exigem administrador.
-- Indices/FKs: hash unico por usuario, origem unica por item, FKs de contas/cartao revisados.
-- Rollback: reverter frontend; remover RPCs/indices/colunas somente apos exportar a revisao.

ALTER TABLE public.uploaded_transaction_images
  ADD COLUMN content_hash text CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN reference_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  ADD COLUMN prompt_version text,
  ADD COLUMN document_type text,
  ADD COLUMN analysis_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN analysis_warnings text[] NOT NULL DEFAULT '{}',
  ADD COLUMN visible_transaction_count integer,
  ADD COLUMN extracted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_token uuid,
  ADD COLUMN processing_started_at timestamptz;
CREATE UNIQUE INDEX uq_uploaded_image_hash ON public.uploaded_transaction_images(user_id,content_hash) WHERE content_hash IS NOT NULL;

ALTER TABLE public.ocr_detected_transactions
  ADD COLUMN source_key text,
  ADD COLUMN movement_kind text NOT NULL DEFAULT 'unknown',
  ADD COLUMN transaction_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN issues text[] NOT NULL DEFAULT '{}',
  ADD COLUMN external_reference text,
  ADD COLUMN review_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN review_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  ADD COLUMN review_destination_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
UPDATE public.ocr_detected_transactions SET source_key=id::text;
ALTER TABLE public.ocr_detected_transactions ALTER COLUMN source_key SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.ocr_detected_transactions ALTER COLUMN source_key SET NOT NULL;
ALTER TABLE public.ocr_detected_transactions DROP CONSTRAINT ocr_detected_type_valid;
ALTER TABLE public.ocr_detected_transactions ADD CONSTRAINT ocr_detected_type_valid CHECK (detected_type IS NULL OR detected_type IN ('income','expense','transfer'));
CREATE UNIQUE INDEX uq_ocr_image_source ON public.ocr_detected_transactions(user_id,image_id,source_key);
CREATE INDEX idx_ocr_review_account ON public.ocr_detected_transactions(review_account_id) WHERE review_account_id IS NOT NULL;
CREATE INDEX idx_ocr_review_card ON public.ocr_detected_transactions(review_card_id) WHERE review_card_id IS NOT NULL;
CREATE INDEX idx_ocr_review_destination ON public.ocr_detected_transactions(review_destination_account_id) WHERE review_destination_account_id IS NOT NULL;
CREATE INDEX idx_ocr_candidate_match ON public.ocr_detected_transactions(user_id,detected_date,detected_amount) WHERE review_status IN ('pending','needs_review');

CREATE FUNCTION public.ocr_text_key(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT trim(regexp_replace(translate(lower(coalesce(value,'')),
    'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g'));
$$;

CREATE FUNCTION public.ocr_duplicate_matches(
  p_date date,p_amount numeric,p_type text,p_description text,p_candidate_id uuid,
  p_account_id uuid DEFAULT NULL,p_card_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS id),
matches AS (
  SELECT 'transaction'::text AS source,t.id,t.occurred_at AS date,t.amount,t.type,t.description,
    coalesce(c.name,a.name,'Conta nao identificada') AS account,NULL::uuid AS image_id
  FROM public.transactions t JOIN o ON o.id=t.user_id
  LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN credit_cards c ON c.id=t.credit_card_id
  WHERE t.occurred_at=p_date AND t.amount=p_amount AND t.type=p_type
    AND (p_account_id IS NULL OR t.account_id=p_account_id)
    AND (p_card_id IS NULL OR t.credit_card_id=p_card_id)
    AND (public.ocr_text_key(p_description)='' OR public.ocr_text_key(t.description)=''
      OR public.ocr_text_key(t.description)=public.ocr_text_key(p_description)
      OR (length(public.ocr_text_key(p_description))>=5 AND
        (position(public.ocr_text_key(p_description) IN public.ocr_text_key(t.description))>0
        OR position(public.ocr_text_key(t.description) IN public.ocr_text_key(p_description))>0)))
  UNION ALL
  SELECT 'review',d.id,d.detected_date,d.detected_amount,d.detected_type,d.detected_description,
    coalesce(c.name,a.name,d.detected_account,'Conta nao identificada'),d.image_id
  FROM public.ocr_detected_transactions d JOIN o ON o.id=d.user_id
  LEFT JOIN accounts a ON a.id=d.review_account_id LEFT JOIN credit_cards c ON c.id=d.review_card_id
  WHERE d.id<>p_candidate_id AND d.review_status IN ('pending','needs_review')
    AND d.detected_date=p_date AND d.detected_amount=p_amount
    AND (d.detected_type=p_type OR d.detected_type IS NULL OR p_type IS NULL)
    AND (p_account_id IS NULL OR d.review_account_id IS NULL OR d.review_account_id=p_account_id)
    AND (p_card_id IS NULL OR d.review_card_id IS NULL OR d.review_card_id=p_card_id)
    AND (public.ocr_text_key(p_description)='' OR public.ocr_text_key(d.detected_description)=''
      OR public.ocr_text_key(d.detected_description)=public.ocr_text_key(p_description)
      OR (length(public.ocr_text_key(p_description))>=5 AND
        (position(public.ocr_text_key(p_description) IN public.ocr_text_key(d.detected_description))>0
        OR position(public.ocr_text_key(d.detected_description) IN public.ocr_text_key(p_description))>0)))
), limited AS (SELECT * FROM matches ORDER BY source,id LIMIT 5)
SELECT coalesce(jsonb_agg(to_jsonb(limited)),'[]'::jsonb) FROM limited;
$$;

CREATE FUNCTION public.begin_ocr_processing(p_image_id uuid,p_reference_date date,p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE img record; token uuid:=gen_random_uuid(); uid uuid:=(SELECT auth.uid());
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  SELECT id,processing_status,processing_started_at INTO img FROM uploaded_transaction_images WHERE id=p_image_id AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imagem nao encontrada'; END IF;
  IF img.processing_status='processing' AND img.processing_started_at>now()-interval '2 minutes' THEN
    RETURN jsonb_build_object('status','busy'); END IF;
  IF img.processing_status='completed' AND NOT p_force THEN RETURN jsonb_build_object('status','completed'); END IF;
  IF p_reference_date IS NULL OR p_reference_date NOT BETWEEN date '1900-01-01' AND date '2200-12-31' THEN RAISE EXCEPTION 'Data de referencia invalida'; END IF;
  UPDATE uploaded_transaction_images SET processing_status='processing',processing_started_at=now(),processing_token=token,
    reference_date=p_reference_date,error_message=NULL WHERE id=p_image_id;
  RETURN jsonb_build_object('status','claimed','token',token);
END $$;

CREATE FUNCTION public.finish_ocr_processing(p_image_id uuid,p_token uuid,p_result jsonb,p_prompt_version text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=(SELECT auth.uid()); item jsonb; n integer; old_count integer;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  PERFORM 1 FROM uploaded_transaction_images WHERE id=p_image_id AND user_id=uid AND processing_token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leitura substituida ou imagem indisponivel'; END IF;
  IF jsonb_typeof(p_result->'transactions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Resposta de leitura invalida'; END IF;
  n:=jsonb_array_length(p_result->'transactions');
  IF n>500 THEN RAISE EXCEPTION 'Divida a imagem em trechos menores'; END IF;
  SELECT count(*) INTO old_count FROM ocr_detected_transactions WHERE image_id=p_image_id AND user_id=uid AND review_status IN ('pending','needs_review');
  IF n=0 AND old_count>0 THEN RAISE EXCEPTION 'A releitura ficou vazia. Os itens anteriores foram preservados'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'transactions') LOOP
    INSERT INTO ocr_detected_transactions(user_id,image_id,source_key,detected_date,detected_amount,detected_type,
      detected_description,detected_payment_method,detected_account,suggested_category,suggested_category_id,
      confidence_level,review_status,raw_text,movement_kind,transaction_status,issues,external_reference)
    VALUES(uid,p_image_id,item->>'source_key',nullif(item->>'date','')::date,(item->>'amount')::numeric,item->>'type',
      item->>'description',item->>'payment_method',item->>'account',item->>'suggested_category',(item->>'suggested_category_id')::uuid,
      item->>'confidence',CASE WHEN item->>'confidence'='baixa' THEN 'needs_review' ELSE 'pending' END,
      item->>'raw_text',item->>'movement_kind',item->>'transaction_status',
      ARRAY(SELECT jsonb_array_elements_text(item->'issues')),item->>'external_reference')
    ON CONFLICT(user_id,image_id,source_key) DO UPDATE SET detected_date=excluded.detected_date,
      detected_amount=excluded.detected_amount,detected_type=excluded.detected_type,detected_description=excluded.detected_description,
      detected_payment_method=excluded.detected_payment_method,detected_account=excluded.detected_account,
      suggested_category=excluded.suggested_category,suggested_category_id=excluded.suggested_category_id,
      confidence_level=excluded.confidence_level,review_status=excluded.review_status,raw_text=excluded.raw_text,
      movement_kind=excluded.movement_kind,transaction_status=excluded.transaction_status,issues=excluded.issues,
      external_reference=excluded.external_reference
    WHERE ocr_detected_transactions.review_status IN ('pending','needs_review');
  END LOOP;
  DELETE FROM ocr_detected_transactions WHERE image_id=p_image_id AND user_id=uid AND review_status IN ('pending','needs_review')
    AND source_key NOT IN (SELECT value->>'source_key' FROM jsonb_array_elements(p_result->'transactions'));
  UPDATE uploaded_transaction_images SET processing_status='completed',processing_token=NULL,
    prompt_version=p_prompt_version,document_type=p_result->>'document_type',analysis_status=p_result->>'analysis_status',
    analysis_warnings=ARRAY(SELECT jsonb_array_elements_text(p_result->'warnings')),
    visible_transaction_count=(p_result->>'visible_transaction_count')::integer,extracted_count=n,
    ocr_confidence=p_result->>'overall_confidence',error_message=NULL WHERE id=p_image_id AND user_id=uid;
  RETURN n;
END $$;

CREATE FUNCTION public.get_ocr_review(p_image_id uuid DEFAULT NULL,p_state text DEFAULT 'all',p_page integer DEFAULT 0,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS id), base AS (
  SELECT d.* FROM ocr_detected_transactions d JOIN o ON o.id=d.user_id WHERE p_image_id IS NULL OR d.image_id=p_image_id
), filtered AS (SELECT * FROM base WHERE p_state='all' OR (p_state='pending' AND review_status IN ('pending','needs_review')) OR review_status=p_state),
page AS (SELECT * FROM filtered ORDER BY created_at,id LIMIT least(greatest(p_page_size,1),50) OFFSET greatest(p_page,0)*least(greatest(p_page_size,1),50)),
rows AS (SELECT page.*,CASE WHEN review_status IN ('pending','needs_review') THEN
  public.ocr_duplicate_matches(detected_date,detected_amount,detected_type,detected_description,id,review_account_id,review_card_id)
  ELSE '[]'::jsonb END AS matches FROM page)
SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),
  'summary',(SELECT jsonb_build_object('total',count(*),'saved',count(*) FILTER(WHERE review_status='saved'),
    'pending',count(*) FILTER(WHERE review_status IN ('pending','needs_review')),
    'incomplete',count(*) FILTER(WHERE review_status IN ('pending','needs_review') AND
      (cardinality(issues)>0 OR confidence_level IS DISTINCT FROM 'alta' OR transaction_status<>'completed'
       OR detected_date IS NULL OR detected_amount IS NULL OR detected_type IS NULL OR detected_payment_method IS NULL)),
    'ignored',count(*) FILTER(WHERE review_status='ignored')) FROM base),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(rows)) FROM rows),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.ocr_text_key(text),public.ocr_duplicate_matches(date,numeric,text,text,uuid,uuid,uuid),
  public.begin_ocr_processing(uuid,date,boolean),public.finish_ocr_processing(uuid,uuid,jsonb,text),
  public.get_ocr_review(uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ocr_text_key(text),public.ocr_duplicate_matches(date,numeric,text,text,uuid,uuid,uuid),
  public.begin_ocr_processing(uuid,date,boolean),public.finish_ocr_processing(uuid,uuid,jsonb,text),
  public.get_ocr_review(uuid,text,integer,integer) TO authenticated;
