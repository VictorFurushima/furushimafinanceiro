-- Objetivo: memoria duravel de importacao e confirmacao atomica com rechecagem de duplicatas.
-- Tabelas afetadas: ocr_import_receipts (nova), ocr_detected_transactions, transactions.
-- Impacto de dados: backfill dos vinculos OCR legados salvos; nao cria despesas.
-- RLS: leitura do espaco, escrita admin do proprio titular; sem DELETE para clientes.
-- Indices/FKs: UNIQUE por origem e referencia bancaria confirmada; FKs preservam recibos ao remover imagem/transacao.
-- Rollback: exportar recibos; reverter RPC de gravacao e frontend antes de retirar a tabela.

CREATE TABLE public.ocr_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_key text NOT NULL,
  image_id uuid REFERENCES public.uploaded_transaction_images(id) ON DELETE SET NULL,
  candidate_id uuid REFERENCES public.ocr_detected_transactions(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  account_scope text,
  bank_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,import_key)
);
CREATE UNIQUE INDEX uq_ocr_bank_reference ON public.ocr_import_receipts(user_id,account_scope,bank_reference) WHERE bank_reference IS NOT NULL;
CREATE INDEX idx_ocr_receipt_image ON public.ocr_import_receipts(image_id) WHERE image_id IS NOT NULL;
CREATE INDEX idx_ocr_receipt_candidate ON public.ocr_import_receipts(candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX idx_ocr_receipt_transaction ON public.ocr_import_receipts(transaction_id) WHERE transaction_id IS NOT NULL;
ALTER TABLE public.ocr_import_receipts ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.ocr_import_receipts TO authenticated;
GRANT ALL ON public.ocr_import_receipts TO service_role;
CREATE POLICY ocr_receipts_read ON public.ocr_import_receipts FOR SELECT TO authenticated
  USING(user_id=(SELECT public.space_owner((SELECT auth.uid()))));
CREATE POLICY ocr_receipts_insert ON public.ocr_import_receipts FOR INSERT TO authenticated
  WITH CHECK(user_id=(SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));
CREATE POLICY ocr_receipts_update ON public.ocr_import_receipts FOR UPDATE TO authenticated
  USING(user_id=(SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
  WITH CHECK(user_id=(SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))));

CREATE FUNCTION public.validate_ocr_ownership() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.user_id<>OLD.user_id THEN RAISE EXCEPTION 'Titular imutavel'; END IF;
  IF NEW.image_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.image_id IS DISTINCT FROM OLD.image_id) AND NOT EXISTS(SELECT 1 FROM uploaded_transaction_images WHERE id=NEW.image_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Imagem de outro titular'; END IF;
  IF TG_TABLE_NAME='ocr_import_receipts' THEN
    IF NEW.transaction_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id) AND NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Transacao de outro titular'; END IF;
    IF NEW.candidate_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id) AND NOT EXISTS(SELECT 1 FROM ocr_detected_transactions WHERE id=NEW.candidate_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Leitura de outro titular'; END IF;
  ELSE
    IF NEW.review_account_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.review_account_id IS DISTINCT FROM OLD.review_account_id) AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.review_account_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Conta de outro titular'; END IF;
    IF NEW.review_destination_account_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.review_destination_account_id IS DISTINCT FROM OLD.review_destination_account_id) AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.review_destination_account_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Destino de outro titular'; END IF;
    IF NEW.review_card_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.review_card_id IS DISTINCT FROM OLD.review_card_id) AND NOT EXISTS(SELECT 1 FROM credit_cards WHERE id=NEW.review_card_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Cartao de outro titular'; END IF;
    IF NEW.suggested_category_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.suggested_category_id IS DISTINCT FROM OLD.suggested_category_id) AND NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.suggested_category_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Categoria de outro titular'; END IF;
    IF NEW.saved_transaction_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.saved_transaction_id IS DISTINCT FROM OLD.saved_transaction_id) AND NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.saved_transaction_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'Transacao de outro titular'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_ocr_receipt BEFORE INSERT OR UPDATE ON public.ocr_import_receipts FOR EACH ROW EXECUTE FUNCTION public.validate_ocr_ownership();
CREATE TRIGGER validate_ocr_candidate BEFORE INSERT OR UPDATE ON public.ocr_detected_transactions FOR EACH ROW EXECUTE FUNCTION public.validate_ocr_ownership();

INSERT INTO public.ocr_import_receipts(user_id,import_key,image_id,candidate_id,transaction_id)
SELECT d.user_id,coalesce(i.content_hash,i.id::text)||':'||d.source_key,i.id,d.id,d.saved_transaction_id
FROM public.ocr_detected_transactions d JOIN public.uploaded_transaction_images i ON i.id=d.image_id
WHERE d.review_status='saved' AND d.saved_transaction_id IS NOT NULL;

CREATE FUNCTION public.save_ocr_review(
  p_detected_id uuid,p_fields jsonb,p_allow_duplicate boolean DEFAULT false,
  p_existing_id uuid DEFAULT NULL,p_recreate_deleted boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=(SELECT auth.uid()); d record; receipt record; previous record;
  origin text; tx uuid; matches jsonb; receipt_id uuid;
  day date:=nullif(p_fields->>'date','')::date; amount numeric:=nullif(p_fields->>'amount','')::numeric;
  kind text:=p_fields->>'type'; descr text:=nullif(trim(p_fields->>'description'),'');
  account uuid:=nullif(p_fields->>'account_id','')::uuid; card uuid:=nullif(p_fields->>'card_id','')::uuid;
  destination uuid:=nullif(p_fields->>'destination_account_id','')::uuid;
  category uuid:=nullif(p_fields->>'category_id','')::uuid; method text:=nullif(p_fields->>'payment_method','');
  scope text; bankref text; confirmed boolean:=coalesce((p_fields->>'confirmed')::boolean,false);
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  -- Serializa confirmacoes do mesmo titular, incluindo itens diferentes da mesma compra.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
  SELECT candidate.*,image.content_hash INTO d FROM ocr_detected_transactions candidate
    JOIN uploaded_transaction_images image ON image.id=candidate.image_id
    WHERE candidate.id=p_detected_id AND candidate.user_id=uid FOR UPDATE OF candidate;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leitura nao encontrada'; END IF;
  IF d.review_status='saved' AND d.saved_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_imported','transaction_id',d.saved_transaction_id); END IF;
  IF d.review_status='ignored' THEN RAISE EXCEPTION 'Reabra o item ignorado antes de salvar'; END IF;
  origin:=coalesce(d.content_hash,d.image_id::text)||':'||d.source_key;
  scope:=CASE WHEN method='credito' THEN 'card:'||card::text ELSE 'account:'||account::text END;
  IF coalesce((p_fields->>'reference_verified')::boolean,false) THEN
    bankref:=nullif(upper(regexp_replace(coalesce(p_fields->>'external_reference',''),'\s','','g')),'');
    IF bankref IS NULL OR length(bankref)<12 OR length(bankref)>160 OR scope IS NULL THEN RAISE EXCEPTION 'Confira o identificador bancario completo e a conta'; END IF;
  END IF;
  SELECT id,transaction_id,import_key,bank_reference INTO receipt FROM ocr_import_receipts
    WHERE user_id=uid AND (import_key=origin OR (bankref IS NOT NULL AND bank_reference=bankref AND account_scope=scope))
    ORDER BY (import_key=origin) DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    receipt_id:=receipt.id;
    IF receipt.transaction_id IS NOT NULL THEN
      IF receipt.import_key<>origin THEN
        SELECT t.occurred_at,t.amount,t.type INTO previous FROM transactions t WHERE t.id=receipt.transaction_id AND t.user_id=uid;
        IF previous.amount IS DISTINCT FROM amount OR previous.type IS DISTINCT FROM kind OR previous.occurred_at IS DISTINCT FROM day THEN
          RETURN jsonb_build_object('status','reference_conflict','transaction_id',receipt.transaction_id); END IF;
      END IF;
      UPDATE ocr_detected_transactions SET review_status='saved',saved_transaction_id=receipt.transaction_id WHERE id=p_detected_id;
      INSERT INTO ocr_import_receipts(user_id,import_key,image_id,candidate_id,transaction_id)
        VALUES(uid,origin,d.image_id,d.id,receipt.transaction_id) ON CONFLICT(user_id,import_key) DO NOTHING;
      RETURN jsonb_build_object('status','already_imported','transaction_id',receipt.transaction_id);
    ELSIF NOT p_recreate_deleted THEN RETURN jsonb_build_object('status','deleted_original'); END IF;
  END IF;
  IF day IS NULL OR day NOT BETWEEN date '1900-01-01' AND date '2200-12-31' OR amount IS NULL OR amount<=0 OR amount<>round(amount,2)
    OR kind IS NULL OR kind NOT IN ('income','expense','transfer') OR descr IS NULL THEN RAISE EXCEPTION 'Preencha data, valor, tipo e descricao validos'; END IF;
  IF method IS NULL OR method NOT IN ('pix','debito','credito','dinheiro','boleto','transferencia') THEN RAISE EXCEPTION 'Selecione a forma de pagamento'; END IF;
  IF method='credito' THEN
    IF card IS NULL OR kind<>'expense' OR NOT EXISTS(SELECT 1 FROM credit_cards WHERE id=card AND user_id=uid) THEN RAISE EXCEPTION 'Selecione o cartao da compra'; END IF;
    account:=NULL;
  ELSIF account IS NULL OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=account AND user_id=uid) THEN RAISE EXCEPTION 'Selecione a conta da movimentacao'; END IF;
  IF kind='transfer' THEN
    IF destination IS NULL OR destination=account OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=destination AND user_id=uid) THEN RAISE EXCEPTION 'Selecione contas de origem e destino diferentes'; END IF;
    method:='transferencia'; category:=NULL;
  ELSE destination:=NULL; END IF;
  IF category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories WHERE id=category AND user_id=uid AND type=kind) THEN RAISE EXCEPTION 'Categoria incompativel com o tipo'; END IF;
  IF (cardinality(d.issues)>0 OR d.transaction_status<>'completed' OR d.confidence_level<>'alta') AND NOT confirmed THEN
    RAISE EXCEPTION 'Confira os avisos e confirme a revisao deste item'; END IF;
  matches:=public.ocr_duplicate_matches(day,amount,kind,descr,d.id,account,card);
  IF p_existing_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(matches) m WHERE m->>'source'='transaction' AND m->>'id'=p_existing_id::text) THEN
      RAISE EXCEPTION 'O lancamento escolhido nao corresponde mais. Atualize a revisao'; END IF;
    tx:=p_existing_id;
  ELSE
    IF coalesce(p_fields->>'movement_kind',d.movement_kind)='bill_payment' THEN
      RAISE EXCEPTION 'Quite a fatura em Cartoes e vincule o pagamento existente. Evite uma segunda despesa'; END IF;
    IF jsonb_array_length(matches)>0 AND NOT p_allow_duplicate THEN
      RETURN jsonb_build_object('status','possible_duplicate','matches',matches); END IF;
    INSERT INTO transactions(user_id,occurred_at,amount,type,flow,description,category_id,account_id,destination_account_id,payment_method,credit_card_id,notes)
      VALUES(uid,day,amount,kind,'real',left(descr,300),category,account,destination,method,
        CASE WHEN method='credito' THEN card ELSE NULL END,
        CASE WHEN coalesce(p_fields->>'movement_kind',d.movement_kind)='refund' THEN 'Estorno confirmado na revisao do print' ELSE NULL END)
      RETURNING id INTO tx;
  END IF;
  IF receipt_id IS NOT NULL THEN
    UPDATE ocr_import_receipts SET transaction_id=tx WHERE id=receipt_id;
  END IF;
  INSERT INTO ocr_import_receipts(user_id,import_key,image_id,candidate_id,transaction_id,account_scope,bank_reference)
    VALUES(uid,origin,d.image_id,d.id,tx,scope,CASE WHEN receipt_id IS NULL THEN bankref ELSE NULL END)
    ON CONFLICT(user_id,import_key) DO UPDATE SET transaction_id=excluded.transaction_id;
  UPDATE ocr_detected_transactions SET review_status='saved',saved_transaction_id=tx,detected_date=day,detected_amount=amount,
    detected_type=kind,detected_description=descr,detected_payment_method=method,review_account_id=account,
    review_card_id=CASE WHEN method='credito' THEN card ELSE NULL END,review_destination_account_id=destination,
    suggested_category_id=category,possible_duplicate=false WHERE id=p_detected_id;
  RETURN jsonb_build_object('status',CASE WHEN p_existing_id IS NULL THEN 'saved' ELSE 'linked' END,'transaction_id',tx);
END $$;

-- A API antiga usa a mesma protecao; nao fica um caminho alternativo sem recibo.
CREATE OR REPLACE FUNCTION public.save_ocr_detected_transaction(
  p_detected_id uuid,p_occurred_at date,p_amount numeric,p_type text,p_description text,
  p_category_id uuid,p_account_id uuid,p_payment_method text,p_credit_card_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE result jsonb;
BEGIN
  result:=public.save_ocr_review(p_detected_id,jsonb_build_object('date',p_occurred_at,'amount',p_amount,'type',p_type,
    'description',p_description,'category_id',p_category_id,'account_id',p_account_id,'payment_method',p_payment_method,
    'card_id',p_credit_card_id,'confirmed',true));
  IF result->>'status' NOT IN ('saved','linked','already_imported') THEN RAISE EXCEPTION 'Atualize o importador e revise a possivel duplicacao'; END IF;
  RETURN (result->>'transaction_id')::uuid;
END $$;
REVOKE ALL ON FUNCTION public.validate_ocr_ownership(),public.save_ocr_review(uuid,jsonb,boolean,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ocr_review(uuid,jsonb,boolean,uuid,boolean) TO authenticated;
