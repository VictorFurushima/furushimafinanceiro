import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const file = (p) => readFile(new URL(p, import.meta.url), "utf8");
const q = async (s, args = []) => (await db.query(s, args)).rows;
const one = async (s, args = []) => Object.values((await q(s, args))[0])[0];
const owner = "00000000-0000-4000-8000-000000000011",
  other = "00000000-0000-4000-8000-000000000012",
  viewer = "00000000-0000-4000-8000-000000000013";
let count = 0;
async function check(label, fn) {
  await fn();
  console.log("PASS", label);
  count++;
}
const history = () => one("SELECT get_financial_history()");
const latest = async () => (await history()).rows[0].id;
const undo = (id) => one("SELECT revert_financial_action($1)", [id]);
const reject = (s, args, rx) => assert.rejects(() => db.query(s, args), rx);
try {
  await db.exec(await file("fixtures/financial-schema-before.sql"));
  await db.exec(
    `GRANT USAGE ON SCHEMA private TO authenticated;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;INSERT INTO storage.buckets(id) VALUES ('transaction-prints');`,
  );
  for (const name of [
    "20260904190000_harden_financial_ledger.sql",
    "20260904190100_fix_financial_cash_series.sql",
    "20260904190200_full_project_hardening.sql",
    "20260922180000_installments_dashboard.sql",
    "20260922181000_ocr_review_pipeline.sql",
    "20260922182000_ocr_import_receipts.sql",
    "20261005163000_ocr_card_selection.sql",
  ])
    await db.exec(await file("../supabase/migrations/" + name));
  await db.exec(
    `INSERT INTO auth.users(id,email) VALUES ('${owner}','owner@test'),('${other}','other@test'),('${viewer}','viewer@test');INSERT INTO profiles(id,full_name) VALUES ('${owner}','Owner'),('${other}','Other'),('${viewer}','Viewer');INSERT INTO user_roles(user_id,role,owner_id) VALUES ('${owner}','admin',null),('${other}','admin',null),('${viewer}','viewer','${owner}');`,
  );
  const account = await one(
    "INSERT INTO accounts(user_id,name,initial_balance) VALUES ($1,'Banco',1000) RETURNING id",
    [owner],
  );
  const destination = await one(
    "INSERT INTO accounts(user_id,name,initial_balance) VALUES ($1,'Carteira',0) RETURNING id",
    [owner],
  );
  const card = await one(
    "INSERT INTO credit_cards(user_id,name,total_limit,closing_day,due_day) VALUES ($1,'XP',10000,25,5) RETURNING id",
    [owner],
  );
  const category = await one(
    "INSERT INTO categories(user_id,name,type) VALUES ($1,'Alimentacao','expense') RETURNING id",
    [owner],
  );
  const investment = await one(
    "INSERT INTO investments(user_id,name,invested_amount,current_amount,initial_amount) VALUES ($1,'Reserva',100,100,100) RETURNING id",
    [owner],
  );
  await db.exec(await file("../supabase/migrations/20261005181000_financial_action_history.sql"));
  await db.exec(
    `SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);`,
  );
  await check("history starts empty and never invents earlier actions", async () =>
    assert.equal((await history()).count, 0),
  );
  const tx = await one(
    "INSERT INTO transactions(user_id,type,amount,description,account_id) VALUES ($1,'expense',20,'Almoco',$2) RETURNING id",
    [owner, account],
  );
  const create = await latest();
  await check("creation is captured automatically and reverse removes it atomically", async () => {
    assert.equal((await history()).rows[0].root_table, "transactions");
    assert.equal((await undo(create)).status, "reverted");
    assert.equal(await one("SELECT count(*) FROM transactions WHERE id=$1", [tx]), 0);
    assert.equal((await undo(create)).status, "already_reverted");
  });
  const edited = await one(
    "INSERT INTO transactions(user_id,type,amount,description,account_id) VALUES ($1,'expense',20,'Editar',$2) RETURNING id",
    [owner, account],
  );
  await db.query("UPDATE transactions SET amount=30 WHERE id=$1", [edited]);
  const edit = await latest();
  await check("editing restores original values and balance", async () => {
    assert.equal((await undo(edit)).status, "reverted");
    assert.equal(Number(await one("SELECT amount FROM transactions WHERE id=$1", [edited])), 20);
  });
  await db.query("DELETE FROM transactions WHERE id=$1", [edited]);
  const del = await latest();
  await check("delete restores same ID and row instead of creating a duplicate", async () => {
    assert.equal((await undo(del)).status, "reverted");
    assert.equal(Number(await one("SELECT amount FROM transactions WHERE id=$1", [edited])), 20);
  });
  const purchase = await one(
    "INSERT INTO transactions(user_id,type,amount,description,credit_card_id,installment_count) VALUES ($1,'expense',100,'Parcelada',$2,3) RETURNING id",
    [owner, card],
  );
  const purchaseAction = await latest();
  await check("card purchase groups transaction, installments, bills and limit", async () => {
    const detail = await one("SELECT get_financial_action($1)", [purchaseAction]);
    assert.equal(detail.can_revert, true);
    assert.ok(detail.changes.some((c) => c.table === "credit_card_bill_items"));
    assert.ok(detail.changes.some((c) => c.table === "credit_cards"));
    assert.equal(Number(await one("SELECT used_limit FROM credit_cards WHERE id=$1", [card])), 100);
  });
  const bill = await one(
    "SELECT bill_id FROM credit_card_bill_items WHERE transaction_id=$1 ORDER BY installment_number LIMIT 1",
    [purchase],
  );
  await db.query("SELECT pay_credit_card_bill($1,$2)", [bill, account]);
  const pay = await latest();
  await check(
    "older purchase is blocked after payment; undoing payment reopens bill and restores limit",
    async () => {
      assert.equal((await undo(purchaseAction)).status, "conflict");
      assert.equal((await undo(pay)).status, "reverted");
      assert.notEqual(
        await one("SELECT status FROM credit_card_bills WHERE id=$1", [bill]),
        "paga",
      );
      assert.equal(
        Number(await one("SELECT used_limit FROM credit_cards WHERE id=$1", [card])),
        100,
      );
    },
  );
  await check("purchase can then be reversed with all ledger children removed", async () => {
    assert.equal((await undo(purchaseAction)).status, "reverted");
    assert.equal(Number(await one("SELECT used_limit FROM credit_cards WHERE id=$1", [card])), 0);
    assert.equal(
      await one("SELECT count(*) FROM credit_card_bill_items WHERE transaction_id=$1", [purchase]),
      0,
    );
  });
  await check("deleted card purchase restores exact installments and bills", async () => {
    const p = await one(
      "INSERT INTO transactions(user_id,type,amount,description,credit_card_id,installment_count) VALUES ($1,'expense',50,'Excluir compra',$2,2) RETURNING id",
      [owner, card],
    );
    const before = await q(
      "SELECT * FROM credit_card_bill_items WHERE transaction_id=$1 ORDER BY installment_number",
      [p],
    );
    await db.query("DELETE FROM transactions WHERE id=$1", [p]);
    assert.equal((await undo(await latest())).status, "reverted");
    assert.deepEqual(
      await q(
        "SELECT * FROM credit_card_bill_items WHERE transaction_id=$1 ORDER BY installment_number",
        [p],
      ),
      before,
    );
  });
  await check("subsequent edits block older undo without changing current data", async () => {
    await db.query("UPDATE transactions SET description='Primeira' WHERE id=$1", [edited]);
    const first = await latest();
    await db.query("UPDATE transactions SET description='Segunda' WHERE id=$1", [edited]);
    const second = await latest();
    assert.equal((await undo(first)).status, "conflict");
    assert.equal(
      await one("SELECT description FROM transactions WHERE id=$1", [edited]),
      "Segunda",
    );
    assert.equal((await undo(second)).status, "reverted");
    assert.equal((await undo(first)).status, "reverted");
  });
  await check(
    "new references block deleting a created category rather than nulling unrelated rows",
    async () => {
      const cat = await one(
        "INSERT INTO categories(user_id,name,type) VALUES ($1,'Nova','expense') RETURNING id",
        [owner],
      );
      const action = await latest();
      const t = await one(
        "INSERT INTO transactions(user_id,type,amount,account_id,category_id) VALUES ($1,'expense',8,$2,$3) RETURNING id",
        [owner, account, cat],
      );
      assert.equal((await undo(action)).status, "conflict");
      assert.equal(await one("SELECT category_id FROM transactions WHERE id=$1", [t]), cat);
    },
  );
  await check("transfer undo restores both account balances", async () => {
    const before = await one("SELECT get_account_balances()");
    await db.query(
      "INSERT INTO transactions(user_id,type,amount,account_id,destination_account_id,payment_method) VALUES ($1,'transfer',12,$2,$3,'transferencia')",
      [owner, account, destination],
    );
    assert.equal((await undo(await latest())).status, "reverted");
    assert.deepEqual(await one("SELECT get_account_balances()"), before);
  });
  await check(
    "investment contribution undo restores investment, event and account movement",
    async () => {
      const before = await q("SELECT * FROM investments WHERE id=$1", [investment]);
      await db.query("SELECT invest_contribute($1,25,CURRENT_DATE,$2,'Aporte teste')", [
        investment,
        account,
      ]);
      assert.equal((await undo(await latest())).status, "reverted");
      assert.deepEqual(await q("SELECT * FROM investments WHERE id=$1", [investment]), before);
      assert.equal(
        await one("SELECT count(*) FROM investment_events WHERE investment_id=$1", [investment]),
        0,
      );
    },
  );
  await check("category deletion and cascaded budgets are restored together", async () => {
    const cat = await one(
      "INSERT INTO categories(user_id,name,type) VALUES ($1,'Orcamento','expense') RETURNING id",
      [owner],
    );
    const budget = await one(
      "INSERT INTO budgets(user_id,category_id,amount,month) VALUES ($1,$2,100,'2026-10-01') RETURNING id",
      [owner, cat],
    );
    await db.query("DELETE FROM categories WHERE id=$1", [cat]);
    assert.equal((await undo(await latest())).status, "reverted");
    assert.equal(await one("SELECT category_id FROM budgets WHERE id=$1", [budget]), cat);
  });
  await check("preference undo preserves profile identity and previous principal", async () => {
    await db.query("UPDATE profiles SET primary_card_id=$1 WHERE id=$2", [card, owner]);
    assert.equal((await undo(await latest())).status, "reverted");
    assert.equal(await one("SELECT primary_card_id FROM profiles WHERE id=$1", [owner]), null);
  });
  await check("history is immutable, private replay cannot be activated by clients", async () => {
    await reject("DELETE FROM financial_actions", [], /permission denied/);
    await reject("UPDATE financial_action_changes SET before_row=null", [], /permission denied/);
    await reject(
      "INSERT INTO private.history_replay_context VALUES(txid_current(),$1,$2)",
      [owner, create],
      /permission denied/,
    );
    assert.equal(await one("SELECT private.history_replay_active()"), false);
  });
  await check(
    "viewers read history but cannot revert; other owners see no history or details",
    async () => {
      await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false)`);
      assert.ok((await history()).count > 0);
      await reject("SELECT revert_financial_action($1)", [del], /Administrador/);
      await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false)`);
      assert.equal((await history()).count, 0);
      await reject("SELECT get_financial_action($1)", [del], /nao encontrada/);
      await reject("SELECT revert_financial_action($1)", [del], /nao encontrada/);
      await db.exec(`SELECT set_config('request.jwt.claim.sub','${owner}',false)`);
    },
  );
  await check("history pagination and status filters are checked server-side", async () => {
    assert.equal((await one("SELECT get_financial_history(0,2,'reverted')")).rows.length, 2);
    assert.equal(
      (await one("SELECT get_financial_history(0,25,'all','transactions')")).rows.every(
        (r) => r.change_count > 0,
      ),
      true,
    );
    await reject("SELECT get_financial_history(-1)", [], /Filtro/);
    await reject("SELECT get_financial_history(0,1000)", [], /Filtro/);
    await reject("SELECT get_financial_history(0,25,'all','user_roles')", [], /Area/);
  });

  await check("a reversal can be reversed again with explicit audit linkage", async () => {
    const id = await one(
      "INSERT INTO transactions(user_id,type,amount,description,account_id) VALUES ($1,'income',17,'Refazer',$2) RETURNING id",
      [owner, account],
    );
    const action = await latest();
    const result = await undo(action);
    assert.equal(result.status, "reverted");
    assert.equal(
      (await one("SELECT get_financial_action($1)", [result.reversal_id])).action.reversal_of,
      action,
    );
    assert.equal((await undo(result.reversal_id)).status, "reverted");
    assert.equal(Number(await one("SELECT amount FROM transactions WHERE id=$1", [id])), 17);
  });
  await check(
    "shopping completion reverses down payment, card installments and planner together",
    async () => {
      const id = await one(
        "INSERT INTO shopping_items(user_id,item,price,payment_method,card_id,account_id,installments,down_payment) VALUES ($1,'Mesa',200,'credito_parcelado',$2,$3,2,50) RETURNING id",
        [owner, card, account],
      );
      const before = await q("SELECT * FROM shopping_items WHERE id=$1", [id]);
      const balance = await one("SELECT get_account_balances()");
      const used = await one("SELECT used_limit FROM credit_cards WHERE id=$1", [card]);
      const tx = await one("SELECT complete_shopping_item($1,true,CURRENT_DATE)", [id]);
      const entry = await one(
        "SELECT down_payment_transaction_id FROM shopping_items WHERE id=$1",
        [id],
      );
      assert.ok(entry);
      assert.equal((await undo(await latest())).status, "reverted");
      assert.deepEqual(await q("SELECT * FROM shopping_items WHERE id=$1", [id]), before);
      assert.equal(
        await one("SELECT count(*) FROM transactions WHERE id=ANY($1::uuid[])", [[tx, entry]]),
        0,
      );
      assert.deepEqual(await one("SELECT get_account_balances()"), balance);
      assert.equal(await one("SELECT used_limit FROM credit_cards WHERE id=$1", [card]), used);
    },
  );
  await check("recharge confirmation reverses income and restores pending schedule", async () => {
    const id = await one(
      "INSERT INTO balance_recharges(user_id,name,expected_amount,expected_date,account_id,payment_method) VALUES ($1,'Salario teste',80,CURRENT_DATE,$2,'pix') RETURNING id",
      [owner, account],
    );
    const before = await q("SELECT * FROM balance_recharges WHERE id=$1", [id]);
    const tx = await one("SELECT confirm_recharge_as_income($1)", [id]);
    assert.equal((await undo(await latest())).status, "reverted");
    assert.deepEqual(await q("SELECT * FROM balance_recharges WHERE id=$1", [id]), before);
    assert.equal(await one("SELECT count(*) FROM transactions WHERE id=$1", [tx]), 0);
  });
  await check("investment redemption and value changes restore every linked event", async () => {
    const before = await q("SELECT * FROM investments WHERE id=$1", [investment]);
    const balance = await one("SELECT get_account_balances()");
    await db.query("SELECT invest_redeem($1,10,CURRENT_DATE,$2,'Resgate')", [investment, account]);
    assert.equal((await undo(await latest())).status, "reverted");
    assert.deepEqual(await q("SELECT * FROM investments WHERE id=$1", [investment]), before);
    assert.deepEqual(await one("SELECT get_account_balances()"), balance);
    await db.query("SELECT invest_update_value($1,150,'Valor')", [investment]);
    assert.equal((await undo(await latest())).status, "reverted");
    assert.deepEqual(await q("SELECT * FROM investments WHERE id=$1", [investment]), before);
  });
  await check(
    "investment deletion restores cascading events with the same identifiers",
    async () => {
      const id = await one(
        "INSERT INTO investments(user_id,name,invested_amount,current_amount,initial_amount) VALUES($1,'Excluir reserva',90,90,90) RETURNING id",
        [owner],
      );
      await db.query("SELECT invest_update_value($1,95,'Rendimento')", [id]);
      const before = await q("SELECT * FROM investment_events WHERE investment_id=$1", [id]);
      await db.query("DELETE FROM investments WHERE id=$1", [id]);
      assert.equal((await undo(await latest())).status, "reverted");
      assert.deepEqual(
        await q("SELECT * FROM investment_events WHERE investment_id=$1", [id]),
        before,
      );
    },
  );
  await check(
    "OCR save reversal preserves the file, returns review to pending and remains retry-safe",
    async () => {
      const image = await one(
        "INSERT INTO uploaded_transaction_images(user_id,file_name,storage_path,content_hash) VALUES($1,'undo.png',$2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') RETURNING id",
        [owner, owner + "/undo.png"],
      );
      const candidate = await one(
        "INSERT INTO ocr_detected_transactions(user_id,image_id,source_key,detected_date,detected_amount,detected_type,detected_description,detected_payment_method,confidence_level,movement_kind,transaction_status) VALUES($1,$2,'undo:1','2026-10-05',21,'expense','OCR teste','pix','alta','payment','completed') RETURNING id",
        [owner, image],
      );
      const fields = {
        date: "2026-10-05",
        amount: 21,
        type: "expense",
        description: "OCR teste",
        payment_method: "pix",
        account_id: account,
        confirmed: true,
        movement_kind: "payment",
      };
      const saved = await one("SELECT save_ocr_review($1,$2)", [candidate, fields]);
      assert.equal(saved.status, "saved");
      const action = await latest();
      assert.equal((await undo(action)).status, "reverted");
      assert.equal(
        await one("SELECT review_status FROM ocr_detected_transactions WHERE id=$1", [candidate]),
        "pending",
      );
      assert.equal(
        await one("SELECT count(*) FROM uploaded_transaction_images WHERE id=$1", [image]),
        1,
      );
      assert.equal(
        await one("SELECT count(*) FROM ocr_import_receipts WHERE candidate_id=$1", [candidate]),
        0,
      );
      const retry = await one("SELECT save_ocr_review($1,$2)", [candidate, fields]);
      assert.equal(retry.status, "saved");
      assert.equal(
        (await one("SELECT save_ocr_review($1,$2)", [candidate, fields])).status,
        "already_imported",
      );
      assert.equal(
        await one("SELECT count(*) FROM transactions WHERE description=$1", ["OCR teste"]),
        1,
      );
    },
  );
  await check(
    "goals, budgets, recurring expenses and settings each retain their prior values",
    async () => {
      for (const [table, sql, args, field, value] of [
        [
          "goals",
          "INSERT INTO goals(user_id,name,target_amount) VALUES($1,'Viagem',500) RETURNING id",
          [owner],
          "target_amount",
          550,
        ],
        [
          "budgets",
          "INSERT INTO budgets(user_id,category_id,amount,month) VALUES($1,$2,80,'2026-11-01') RETURNING id",
          [owner, category],
          "amount",
          95,
        ],
        [
          "recurring_expenses",
          "INSERT INTO recurring_expenses(user_id,name,amount,billing_day,start_date,payment_method,account_id) VALUES($1,'Internet',60,5,CURRENT_DATE,'pix',$2) RETURNING id",
          [owner, account],
          "amount",
          65,
        ],
      ]) {
        const id = await one(sql, args);
        const before = await q(`SELECT * FROM ${table} WHERE id=$1`, [id]);
        await db.query(`UPDATE ${table} SET ${field}=$1 WHERE id=$2`, [value, id]);
        assert.equal((await undo(await latest())).status, "reverted");
        assert.deepEqual(await q(`SELECT * FROM ${table} WHERE id=$1`, [id]), before);
      }
      await db.query("INSERT INTO user_settings(user_id,min_reserve) VALUES($1,100)", [owner]);
      await db.query("UPDATE user_settings SET min_reserve=200 WHERE user_id=$1", [owner]);
      assert.equal((await undo(await latest())).status, "reverted");
      assert.equal(
        Number(await one("SELECT min_reserve FROM user_settings WHERE user_id=$1", [owner])),
        100,
      );
    },
  );
  await check(
    "normal writes still enforce financial, ownership and card preference guards",
    async () => {
      await reject(
        "INSERT INTO transactions(user_id,type,amount,account_id) VALUES($1,'expense',-1,$2)",
        [owner, account],
        /valor|amount|positive|check/i,
      );
      await reject(
        "UPDATE profiles SET primary_card_id=$1 WHERE id=$2",
        [crypto.randomUUID(), owner],
        /cartao ativo/,
      );
      await db.query("UPDATE credit_cards SET used_limit=9000 WHERE id=$1",[card]);
      assert.notEqual(Number(await one("SELECT used_limit FROM credit_cards WHERE id=$1",[card])),9000);
    },
  );
  await check(
    "a reused unique key blocks restoration without overwriting another row",
    async () => {
      const id = await one(
        "INSERT INTO budgets(user_id,category_id,amount,month) VALUES($1,$2,140,'2026-12-01') RETURNING id",
        [owner, category],
      );
      await db.query("DELETE FROM budgets WHERE id=$1", [id]);
      const action = await latest();
      const newer = await one(
        "INSERT INTO budgets(user_id,category_id,amount,month) VALUES($1,$2,160,'2026-12-01') RETURNING id",
        [owner, category],
      );
      assert.equal((await undo(action)).status,"conflict");
      assert.equal(Number(await one("SELECT amount FROM budgets WHERE id=$1", [newer])), 160);
      assert.equal(await one("SELECT count(*) FROM budgets WHERE id=$1", [id]), 0);
      assert.equal(
        (await one("SELECT get_financial_action($1)", [action])).action.reverted_at,
        null,
      );
      assert.equal(await one("SELECT private.history_replay_active()"), false);
    },
  );
  await check("a failed child restoration rolls back restored parents and audit state",async()=>{
    const cat=await one("INSERT INTO categories(user_id,name,type) VALUES($1,'Falha atomica','expense') RETURNING id",[owner]);
    await db.query("INSERT INTO budgets(user_id,category_id,amount,month) VALUES($1,$2,123,'2027-01-01')",[owner,cat]);
    await db.query('DELETE FROM categories WHERE id=$1',[cat]);const action=await latest();
    await db.exec('RESET ROLE;ALTER TABLE budgets ADD CONSTRAINT history_test_failure CHECK(amount<>123) NOT VALID;SET ROLE authenticated');
    await reject('SELECT revert_financial_action($1)',[action],/check constraint/i);
    assert.equal(await one('SELECT count(*) FROM categories WHERE id=$1',[cat]),0);
    assert.equal((await one('SELECT get_financial_action($1)',[action])).action.reverted_at,null);
    assert.equal(await one('SELECT private.history_replay_active()'),false);
    await db.exec('RESET ROLE;ALTER TABLE budgets DROP CONSTRAINT history_test_failure;SET ROLE authenticated');
  });
  console.log(`${count} history integration checks passed`);
} finally {
  await db.close();
}
