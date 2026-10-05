import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['src/lib/ocr-schema.ts'],bundle:true,platform:'node',format:'esm',write:false});
const { normalizeOcrResponse } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const selectionBundle = await build({entryPoints:['src/lib/ocr-review.ts'],bundle:true,platform:'node',format:'esm',write:false});
const { newOcrDraft, resolveOcrDraft, ocrDraftReady, ocrFields } = await import('data:text/javascript;base64,'+Buffer.from(selectionBundle.outputFiles[0].text).toString('base64'));
const db = new PGlite();
const owner='00000000-0000-4000-8000-000000000011', other='00000000-0000-4000-8000-000000000012', viewer='00000000-0000-4000-8000-000000000013';
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
const file=path=>readFile(new URL(path,import.meta.url),'utf8');
let passed=0;
async function check(name,fn){await fn(); passed++; console.log('PASS',name);}
const rejects=(sql,args,pattern)=>assert.rejects(()=>db.query(sql,args),pattern);
const row=(overrides={})=>({date:'2026-09-22',amount:20,type:'expense',description:'Padaria',payment_method:'pix',account:'Banco',suggested_category:null,confidence:'alta',raw_text:'22/09/2026 Padaria R$ 20,00',issues:[],external_reference:null,movement_kind:'payment',transaction_status:'completed',...overrides});
const result=(transactions=[row()],overrides={})=>({document_type:'statement',analysis_status:'complete',visible_transaction_count:transactions.length,warnings:[],overall_confidence:'alta',transactions,...overrides});
try {
 const aCard={id:'a',name:'XP',status:'active',last_four:'5461'}, bCard={id:'b',name:'Nubank',status:'active',last_four:'1234'};
 const item={review_status:'pending',detected_date:'2026-10-05',detected_amount:14.46,detected_type:'expense',detected_description:'Uber',detected_payment_method:'credito',detected_account:'Cartao XP final 5461',raw_text:'Cartao adicional final\n5461.',issues:[],transaction_status:'completed',confidence_level:'alta',movement_kind:'payment'};
 const draft = (overrides={})=>({...newOcrDraft(item),...overrides});
 const resolve = (cards,evidence=item,primary=null,d=draft())=>resolveOcrDraft(d,evidence,cards,primary);
 await check('single card preselects without additional confirmation and serializes audit source',async()=>{
   const d=resolve([aCard]);assert.equal(d.card_id,'a');assert.equal(d.card_selection_source,'ocr_match');assert.equal(ocrDraftReady(item,d),true);
   assert.equal(ocrFields(d).card_selection_source,'ocr_match');
   const unknown={...item,detected_account:null,raw_text:null};assert.equal(resolve([aCard],unknown).card_selection_source,'single_card');
   assert.equal(resolve([{...aCard,last_four:null}]).card_selection_source,'single_card');
 });
 await check('OCR final overrides another principal and manually selected card stays selected',async()=>{
   assert.equal(resolve([aCard,bCard],item,'b').card_id,'a');
   assert.equal(resolve([aCard,bCard],item,'a',draft({card_id:'b',card_selection_source:'manual'})).card_id,'b');
 });
 await check('zero cards, inactive card, unmatched and ambiguous finals need manual selection',async()=>{
   assert.equal(resolve([]).card_id,'');assert.equal(resolve([{...aCard,status:'blocked'}]).card_id,'');
   assert.equal(resolve([aCard],{...item,raw_text:'final 9999',detected_account:null},'a').card_id,'');
   assert.equal(resolve([aCard,{...bCard,last_four:'5461'}],item,'a').card_id,'');
   assert.equal(resolve([aCard,bCard],{...item,raw_text:'final 5461 e final 1234',detected_account:null},'a').card_id,'');
 });
 await check('principal is fallback and amounts, dates and card brand alone do not identify a card',async()=>{
   const evidence={...item,detected_account:'XP',raw_text:'05/10/2026 R$ 54,61 recibo 1234'};
   assert.equal(resolve([aCard,bCard],evidence).card_id,'');assert.equal(resolve([aCard,bCard],evidence,'b').card_selection_source,'primary_card');
   assert.equal(resolve([aCard,bCard],evidence,'missing').card_id,'');
   assert.equal(resolve([aCard,bCard],{...item,detected_account:null,raw_text:'cartao •••• 5461'}).card_id,'a');
 });
 await check('asynchronous cards resolve untouched drafts without overwriting manual edits or OCR warnings',async()=>{
   const stored=draft({description:'Minha descrição'});assert.equal(resolve([],item,null,stored).card_id,'');
   assert.equal(resolve([aCard],item,null,stored).description,'Minha descrição');
   const low={...item,confidence_level:'baixa'};assert.equal(ocrDraftReady(low,resolve([aCard],low)),false);
   assert.equal(resolve([aCard],item,null,draft({payment_method:'pix'})).card_id,'');
 });
 await check('ambiguous date and absent type stay null instead of inventing expense',async()=>{
  const parsed=normalizeOcrResponse(result([row({date:'31/02/2026',type:null})]));
  assert.equal(parsed.transactions[0].date,null);assert.equal(parsed.transactions[0].type,null);assert.equal(parsed.analysis_status,'partial');
 });
 await check('partial rows and two legitimate equal purchases are preserved',async()=>{
  const parsed=normalizeOcrResponse(result([row(),row(),row({amount:null,raw_text:'Loja R$ ...'})]));
  assert.equal(parsed.transactions.length,3);assert.equal(parsed.transactions[2].amount,null);assert.ok(parsed.transactions[2].issues.length);
 });
 await check('missing JSON structure and oversized results fail instead of saving empty',async()=>{
  assert.throws(()=>normalizeOcrResponse({}));assert.throws(()=>normalizeOcrResponse(result(Array.from({length:501},()=>row()))));
  assert.equal(normalizeOcrResponse(result([])).analysis_status,'partial');
 });
 await check('count mismatch and pending movements require review',async()=>{
  const parsed=normalizeOcrResponse(result([row({transaction_status:'pending'})],{visible_transaction_count:3}));
  assert.equal(parsed.analysis_status,'partial');assert.ok(parsed.warnings.length);assert.ok(parsed.transactions[0].issues.length);
 });
 await check('negative amount or fractional cent never silently becomes a valid positive amount',async()=>{
  assert.equal(normalizeOcrResponse(result([row({amount:-20})])).transactions[0].amount,null);
  assert.equal(normalizeOcrResponse(result([row({amount:12.345})])).transactions[0].amount,null);
 });
 await check('missing payment method or source evidence is visibly incomplete',async()=>{
  const parsed=normalizeOcrResponse(result([row({payment_method:null,raw_text:''})]));
  assert.equal(parsed.analysis_status,'partial');assert.equal(parsed.transactions[0].confidence,'baixa');
  assert.equal(parsed.transactions[0].issues.length,2);
 });
 await db.exec(await file('fixtures/financial-schema-before.sql'));
 await db.exec(`GRANT USAGE ON SCHEMA private TO authenticated;
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 INSERT INTO storage.buckets(id) VALUES ('transaction-prints');`);
 for(const name of ['20260904190000_harden_financial_ledger.sql','20260904190100_fix_financial_cash_series.sql','20260904190200_full_project_hardening.sql','20260922180000_installments_dashboard.sql','20260922181000_ocr_review_pipeline.sql','20260922182000_ocr_import_receipts.sql','20261005163000_ocr_card_selection.sql','20261005181000_financial_action_history.sql']) await db.exec(await file('../supabase/migrations/'+name));
 await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${owner}','test-owner@example.com'),('${other}','test-other@example.com'),('${viewer}','test-viewer@example.com');
 INSERT INTO user_roles(user_id,role,owner_id) VALUES ('${owner}','admin',null),('${other}','admin',null),('${viewer}','viewer','${owner}');`);
 await db.exec(`INSERT INTO profiles(id) VALUES ('${owner}'),('${other}'),('${viewer}') ON CONFLICT(id) DO NOTHING;`);
 const account=await one("INSERT INTO accounts(user_id,name,initial_balance) VALUES ($1,'Banco A',10000) RETURNING id",[owner]);
 const destination=await one("INSERT INTO accounts(user_id,name) VALUES ($1,'Banco B') RETURNING id",[owner]);
 const foreignAccount=await one("INSERT INTO accounts(user_id,name) VALUES ($1,'Outro titular') RETURNING id",[other]);
 const card=await one("INSERT INTO credit_cards(user_id,name,total_limit,closing_day,due_day) VALUES ($1,'Cartao',10000,25,5) RETURNING id",[owner]);
 await db.exec(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);`);
 const image=async(hash)=>one("INSERT INTO uploaded_transaction_images(user_id,file_name,storage_path,content_hash) VALUES ($1,'teste.png',$2,$3) RETURNING id",[owner,`${owner}/${crypto.randomUUID()}.png`,hash]);
 const candidate=async(img,key,desc='Padaria',amount=20)=>one("INSERT INTO ocr_detected_transactions(user_id,image_id,source_key,detected_date,detected_amount,detected_type,detected_description,detected_payment_method,confidence_level,movement_kind,transaction_status) VALUES ($1,$2,$3,'2026-09-22',$4,'expense',$5,'pix','alta','payment','completed') RETURNING id",[owner,img,key,amount,desc]);
 const fields=(overrides={})=>({date:'2026-09-22',amount:20,type:'expense',description:'Padaria',payment_method:'pix',account_id:account,confirmed:true,movement_kind:'payment',...overrides});
 const save=(id,data=fields(),allow=false,link=null,recreate=false)=>one('SELECT save_ocr_review($1,$2,$3,$4,$5)',[id,data,allow,link,recreate]);
 await check('profile primary card is owner-scoped, unique per profile, and dismissal persists',async()=>{
   await db.query('UPDATE profiles SET primary_card_id=$1,primary_card_prompt_dismissed=true WHERE id=$2',[card,owner]);
   assert.equal(await one('SELECT primary_card_id FROM profiles WHERE id=$1',[owner]),card);
   assert.equal(await one('SELECT primary_card_prompt_dismissed FROM profiles WHERE id=$1',[owner]),true);
   await rejects('UPDATE profiles SET primary_card_id=$1 WHERE id=$2',[crypto.randomUUID(),owner],/cartao ativo/);
   await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false)");
   const foreignCard=await one("INSERT INTO credit_cards(user_id,name,total_limit) VALUES ($1,'Foreign',1000) RETURNING id",[other]);
   await db.exec(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);`);
   await rejects('UPDATE profiles SET primary_card_id=$1 WHERE id=$2',[foreignCard,owner],/cartao ativo/);
   const temporary=await one("INSERT INTO credit_cards(user_id,name,total_limit,last_four) VALUES ($1,'Temporary',1000,'4321') RETURNING id",[owner]);
   await rejects("UPDATE credit_cards SET last_four='43a1' WHERE id=$1",[temporary],/last_four_check/);
   await db.query('UPDATE profiles SET primary_card_id=$1 WHERE id=$2',[temporary,owner]);
   await db.query('DELETE FROM credit_cards WHERE id=$1',[temporary]);
   assert.equal(await one('SELECT primary_card_id FROM profiles WHERE id=$1',[owner]),null);
   await db.query('UPDATE profiles SET primary_card_id=$1 WHERE id=$2',[card,owner]);
 });
 const img=await image('a'.repeat(64));
 await check('same file hash is unique per owner',async()=>{await rejects("INSERT INTO uploaded_transaction_images(user_id,file_name,storage_path,content_hash) VALUES ($1,'same.png','same',$2)",[owner,'a'.repeat(64)],/uq_uploaded_image_hash/);});
 await check('processing lease prevents concurrent extraction and stale finish',async()=>{
  const claim=await one("SELECT begin_ocr_processing($1,'2026-09-21',false)",[img]);
  assert.equal(claim.status,'claimed');assert.equal((await one("SELECT begin_ocr_processing($1,'2026-09-21',true)",[img])).status,'busy');
  await rejects('SELECT finish_ocr_processing($1,$2,$3,$4)',[img,crypto.randomUUID(),result(),'test'],/substituida/);
  await one('SELECT finish_ocr_processing($1,$2,$3,$4)',[img,claim.token,result([{...row(),source_key:'first'}]),'test']);
 });
 await check('empty reread preserves previous rows atomically',async()=>{
  const claim=await one("SELECT begin_ocr_processing($1,'2026-09-21',true)",[img]);
  await rejects('SELECT finish_ocr_processing($1,$2,$3,$4)',[img,claim.token,result([],{analysis_status:'unreadable'}),'test'],/preservados/);
  assert.equal(Number(await one('SELECT count(*) FROM ocr_detected_transactions WHERE image_id=$1',[img])),1);
  await db.query("UPDATE uploaded_transaction_images SET processing_status='failed',processing_token=null WHERE id=$1",[img]);
 });
 const first=await one('SELECT id FROM ocr_detected_transactions WHERE image_id=$1',[img]);let original;
 await check('save and receipt are atomic and repeat is idempotent',async()=>{
  const saved=await save(first);original=saved.transaction_id;assert.equal(saved.status,'saved');
  assert.equal((await save(first)).status,'already_imported');
  assert.equal(Number(await one('SELECT count(*) FROM transactions WHERE id=$1',[original])),1);
  assert.equal(Number(await one('SELECT count(*) FROM ocr_import_receipts WHERE transaction_id=$1',[original])),1);
 });
 const secondImage=await image('b'.repeat(64));const duplicate=await candidate(secondImage,'dupe');
 await check('duplicate across images is shown and saved only with an explicit decision',async()=>{
  const before=Number(await one('SELECT count(*) FROM transactions'));
  const review=await one('SELECT get_ocr_review($1)',[secondImage]);assert.ok(review.rows[0].matches.some(m=>m.id===original));
  const found=await save(duplicate);assert.equal(found.status,'possible_duplicate');assert.equal(Number(await one('SELECT count(*) FROM transactions')),before);
  assert.equal((await save(duplicate,fields(),false,original)).status,'linked');assert.equal(Number(await one('SELECT count(*) FROM transactions')),before);
 });
 await check('two genuine equal purchases can be kept after explicit confirmation',async()=>{
  const id=await candidate(secondImage,'legitimate');const saved=await save(id,fields(),true);assert.equal(saved.status,'saved');assert.notEqual(saved.transaction_id,original);
 });
 await check('pending duplicates within one image and between images are compared',async()=>{
  const a=await candidate(secondImage,'pending-a','Mercado',33);
  const b=await candidate(secondImage,'pending-b','Mercado',33);
  const c=await candidate(img,'pending-c','Mercado',33);
  const matches=await one("SELECT ocr_duplicate_matches('2026-09-22',33,'expense','Mercado',$1)",[a]);
  assert.ok(matches.some(m=>m.id===b));assert.ok(matches.some(m=>m.id===c));
 });
 await check('same value at different accounts does not block legitimate transactions',async()=>{
  const id=await candidate(secondImage,'other-account');assert.equal((await save(id,fields({account_id:destination}))).status,'saved');
 });
 const bankId=await candidate(secondImage,'bank-a','Pix mercado',77);let bankTx;
 await check('verified bank reference reuses the transaction across different images',async()=>{
  const data=fields({description:'Pix mercado',amount:77,external_reference:'E1234567820260922BANKREFERENCE001',reference_verified:true});
  bankTx=(await save(bankId,data)).transaction_id;
  const id=await candidate(img,'bank-b','Outra descricao',77);
  const response=await save(id,{...data,description:'Outra descricao'});assert.equal(response.status,'already_imported');assert.equal(response.transaction_id,bankTx);
  const conflict=await candidate(img,'bank-conflict','Conflito',78);assert.equal((await save(conflict,{...data,amount:78})).status,'reference_conflict');
 });
 await check('invalid ownership, missing type and bill payment cannot create expenses',async()=>{
  const id=await candidate(secondImage,'invalid','Outro',99);
  await rejects('SELECT save_ocr_review($1,$2)',[id,fields({account_id:foreignAccount,amount:99})],/conta/i);
  await rejects('SELECT save_ocr_review($1,$2)',[id,fields({type:null,amount:99})],/validos/);
  await rejects('SELECT save_ocr_review($1,$2)',[id,fields({movement_kind:'bill_payment',amount:99})],/fatura/);
  await rejects('UPDATE ocr_detected_transactions SET review_account_id=$1 WHERE id=$2',[foreignAccount,id],/outro titular/);
 });
 await check('own transfer moves balances without a new expense',async()=>{
  const id=await candidate(img,'transfer','Entre contas',10);
  const saved=await save(id,fields({type:'transfer',description:'Entre contas',amount:10,destination_account_id:destination,movement_kind:'own_transfer',payment_method:'transferencia'}));
  assert.equal(saved.status,'saved');assert.equal(await one('SELECT type FROM transactions WHERE id=$1',[saved.transaction_id]),'transfer');
 });
 await check('deleting an image keeps durable receipts and protects reimport',async()=>{
  const delImage=await image('c'.repeat(64));const id=await candidate(delImage,'durable','Livraria',88);
  const tx=(await save(id,fields({description:'Livraria',amount:88}))).transaction_id;
  await db.query('DELETE FROM uploaded_transaction_images WHERE id=$1',[delImage]);
  const newImage=await image('c'.repeat(64));const again=await candidate(newImage,'durable','Livraria',88);
  assert.equal((await save(again,fields({description:'Livraria',amount:88}))).transaction_id,tx);
 });
 await check('deleted original requires explicit recreation',async()=>{
  await db.query('DELETE FROM transactions WHERE id=$1',[bankTx]);
  const data=fields({description:'Pix mercado',amount:77,external_reference:'E1234567820260922BANKREFERENCE001',reference_verified:true});
  assert.equal((await save(bankId,data)).status,'deleted_original');
  const recreated=await save(bankId,data,false,null,true);assert.equal(recreated.status,'saved');assert.notEqual(recreated.transaction_id,bankTx);
 });
 let purchase;
 await check('credit import stores automatic/manual origin atomically and preserves idempotency',async()=>{
   const id=await candidate(img,'card-auto','Compra cartão',45);
   const data=fields({description:'Compra cartão',amount:45,payment_method:'credito',card_id:card,card_selection_source:'single_card'});
   const saved=await save(id,data);assert.equal(saved.status,'saved');
   assert.equal(await one('SELECT card_selection_source FROM ocr_detected_transactions WHERE id=$1',[id]),'single_card');
   assert.equal(await one('SELECT card_selection_source FROM ocr_import_receipts WHERE candidate_id=$1',[id]),'single_card');
   assert.equal((await save(id,{...data,card_selection_source:'manual'})).transaction_id,saved.transaction_id);
   assert.equal(await one('SELECT card_selection_source FROM ocr_import_receipts WHERE candidate_id=$1',[id]),'single_card');
   assert.equal((await one('SELECT get_ocr_review($1)',[img])).rows.find(r=>r.id===id).card_selection_source,'single_card');
   const wrong=await candidate(img,'card-bad','Compra inválida',46);
   await rejects('SELECT save_ocr_review($1,$2)',[wrong,{...data,amount:46,card_selection_source:'invalid'}],/Origem de selecao/);
   const manual=await candidate(img,'card-manual','Compra manual',47);
   const manualResult=await save(manual,fields({description:'Compra manual',amount:47,payment_method:'credito',card_id:card}));
   assert.equal(await one('SELECT card_selection_source FROM ocr_import_receipts WHERE transaction_id=$1',[manualResult.transaction_id]),'manual');
   // Remove test transactions so the installment regression retains its original fixture.
   await db.query('DELETE FROM transactions WHERE id=ANY($1::uuid[])',[[saved.transaction_id,manualResult.transaction_id]]);
 });
 await check('installments use ledger amounts and preserve cent totals',async()=>{
  purchase=await one("INSERT INTO transactions(user_id,type,amount,description,occurred_at,credit_card_id,installment_count) VALUES ($1,'expense',100,'Compra teste',CURRENT_DATE,$2,3) RETURNING id",[owner,card]);
  const data=await one('SELECT get_installments()');assert.equal(data.count,1);assert.equal(Number(data.summary.remaining_amount),100);
  assert.deepEqual(data.rows[0].installments.map(i=>Number(i.amount)),[33.34,33.33,33.33]);assert.equal(data.rows[0].paid_count,0);assert.equal(data.forecast.length,12);
 });
 await check('paying invoice updates installment progress without another purchase',async()=>{
  const bill=await one('SELECT bill_id FROM credit_card_bill_items WHERE transaction_id=$1 AND installment_number=1',[purchase]);
  await db.query('SELECT pay_credit_card_bill($1,$2)',[bill,account]);
  const data=await one('SELECT get_installments()');assert.equal(data.rows[0].paid_count,1);assert.equal(Number(data.rows[0].remaining_amount),66.66);
  assert.equal((await one("SELECT get_installments(NULL,'paid')")).count,0);
  assert.equal((await one("SELECT get_installments(NULL,'all','inexistente')")).count,0);
 });
 await check('viewer reads the owner projection but cannot import or mutate receipts',async()=>{
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false);`);
  assert.equal((await one('SELECT get_installments()')).count,1);
  await rejects('SELECT save_ocr_review($1,$2)',[duplicate,fields()],/Administrador/);
  await rejects("SELECT begin_ocr_processing($1,CURRENT_DATE,true)",[img],/Administrador/);
  await rejects("INSERT INTO ocr_import_receipts(user_id,import_key) VALUES ($1,'illegal')",[owner],/row-level security/);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false);`);
  assert.equal((await one('SELECT get_ocr_review()')).count,0);assert.equal((await one('SELECT get_installments()')).count,0);
 });
 console.log(`${passed} tests passed`);
} finally { await db.close(); }
