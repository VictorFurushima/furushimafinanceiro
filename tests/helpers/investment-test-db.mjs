import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const root = new URL("../../", import.meta.url);
export const readProject = (name) => readFile(new URL(name, root), "utf8");
export async function applyInvestmentMigrations(db) {
  // PGlite has no network worker or encrypted Vault. These stubs test SQL boundaries and responses.
  await db.exec(`CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault; CREATE SCHEMA IF NOT EXISTS cron;
  CREATE TABLE net._http_response(id bigint PRIMARY KEY,status_code int,content text,timed_out bool DEFAULT false);
  CREATE TABLE net.http_request_queue(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,url text,params jsonb,headers jsonb);
  CREATE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds int DEFAULT 2000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.http_request_queue(url,params,headers) VALUES($1,$2,$3) RETURNING id $$;
  CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),secret text,name text,description text);
  CREATE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret FROM vault.secrets;
  CREATE FUNCTION vault.create_secret(text,text,text) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(secret,name,description) VALUES($1,$2,$3) RETURNING id $$;
  CREATE FUNCTION vault.update_secret(uuid,text) RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret=$2 WHERE id=$1 $$;
  CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text,schedule text,command text);
  CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;`);
  for (const name of [
    "20261005194500_investment_positions.sql",
    "20261005194600_wallet_market_overview.sql",
    "20261005194700_investment_quote_sync.sql",
    "20261005200500_investment_valuation_history.sql",
  ]) {
    let sql = await readProject("supabase/migrations/" + name);
    sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;$/m, "");
    await db.exec(sql);
  }
}
export async function createInvestmentDb() {
  const db = new PGlite();
  await db.exec(await readProject("tests/fixtures/financial-schema-before.sql"));
  await db.exec(
    `GRANT USAGE ON SCHEMA private TO authenticated;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;INSERT INTO storage.buckets(id) VALUES('transaction-prints');`,
  );
  for (const name of [
    "20260904190000_harden_financial_ledger.sql",
    "20260904190100_fix_financial_cash_series.sql",
    "20260904190200_full_project_hardening.sql",
    "20260922180000_installments_dashboard.sql",
    "20260922181000_ocr_review_pipeline.sql",
    "20260922182000_ocr_import_receipts.sql",
    "20261005163000_ocr_card_selection.sql",
    "20261005181000_financial_action_history.sql",
  ])
    await db.exec(await readProject("supabase/migrations/" + name));
  await applyInvestmentMigrations(db);
  return db;
}
