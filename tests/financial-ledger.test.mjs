import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const sqlFile = (name) => readFile(new URL(name, import.meta.url), "utf8");
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const scalar = async (sql, values = []) => {
  const v = Object.values((await query(sql, values))[0])[0];
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
};
const uid = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const viewer = "00000000-0000-4000-8000-000000000003";
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log("PASS", name);
}
async function reject(sql, params = [], pattern) {
  await assert.rejects(() => db.query(sql, params), pattern);
}
const insertTx = async (fields = {}) => {
  const data = { user_id: uid, type: "expense", amount: 100, occurred_at: "2026-09-04", ...fields };
  const cols = Object.keys(data);
  return scalar(
    `INSERT INTO transactions(${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`,
    Object.values(data),
  );
};
try {
  await db.exec(await sqlFile("fixtures/financial-schema-before.sql"));
  await db.exec("GRANT USAGE ON SCHEMA private TO authenticated;");
  await db.exec(`CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
    INSERT INTO storage.buckets(id) VALUES ('transaction-prints');`);
  await db.exec(await sqlFile("../supabase/migrations/20260904190000_harden_financial_ledger.sql"));
  await db.exec(
    await sqlFile("../supabase/migrations/20260904190100_fix_financial_cash_series.sql"),
  );
  await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${uid}','owner@example.com'),('${other}','other@example.com'),('${viewer}','viewer@example.com');
    INSERT INTO user_roles(user_id,role,owner_id) VALUES ('${uid}','admin',null),('${other}','admin',null),('${viewer}','viewer','${uid}');
    INSERT INTO recurring_expenses(user_id,name,amount,billing_day,start_date,payment_method,status)
      VALUES ('${uid}','Legacy credit',10,1,CURRENT_DATE,'credito','active');`);
  await db.exec(await sqlFile("../supabase/migrations/20260904190200_full_project_hardening.sql"));
  const account = await scalar(
    "INSERT INTO accounts(user_id,name,initial_balance) VALUES ($1,'Bank',1000) RETURNING id",
    [uid],
  );
  const wallet = await scalar(
    "INSERT INTO accounts(user_id,name,type,initial_balance) VALUES ($1,'Cash','cash',50) RETURNING id",
    [uid],
  );
  const foreignAccount = await scalar(
    "INSERT INTO accounts(user_id,name) VALUES ($1,'Other') RETURNING id",
    [other],
  );
  const foreignCard = await scalar(
    "INSERT INTO credit_cards(user_id,name) VALUES ($1,'Other card') RETURNING id",
    [other],
  );
  const card = await scalar(
    "INSERT INTO credit_cards(user_id,name,total_limit,closing_day,due_day) VALUES ($1,'Card',4000,5,12) RETURNING id",
    [uid],
  );
  const category = await scalar(
    "INSERT INTO categories(user_id,name,type) VALUES ($1,'Test','expense') RETURNING id",
    [uid],
  );
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uid}',false);`,
  );
  await check("legacy credit recurrence is paused until a card is selected", async () => {
    assert.equal(
      await scalar("SELECT status FROM recurring_expenses WHERE name='Legacy credit'"),
      "paused",
    );
    await reject(
      "UPDATE recurring_expenses SET status='active' WHERE name='Legacy credit'",
      [],
      /active_credit_card_required/,
    );
  });
  const balances = () => query("SELECT name,balance FROM get_account_balances() ORDER BY name");
  const limit = () => scalar("SELECT used_limit FROM credit_cards WHERE id=$1", [card]);
  let purchase, bill, transfer;
  await check("transfer moves two balances without changing cash or expenses", async () => {
    transfer = await insertTx({
      type: "transfer",
      amount: 100,
      account_id: account,
      destination_account_id: wallet,
    });
    assert.deepEqual(
      (await balances()).map((b) => ({ ...b, balance: Number(b.balance) })),
      [
        { name: "Bank", balance: 900 },
        { name: "Cash", balance: 150 },
      ],
    );
    assert.equal(
      Number(await scalar("SELECT get_financial_overview()->>'saldo_disponivel'")),
      1050,
    );
    assert.equal(
      Number(
        await scalar(
          "SELECT despesas FROM get_monthly_financial_summary('2026-09-01','2026-09-30')",
        ),
      ),
      0,
    );
  });
  await check("card purchase creates invoice without debiting account", async () => {
    purchase = await insertTx({ credit_card_id: card, account_id: account, amount: 100 });
    assert.equal(await scalar("SELECT account_id FROM transactions WHERE id=$1", [purchase]), null);
    bill = await scalar("SELECT bill_id FROM credit_card_bill_items WHERE transaction_id=$1", [
      purchase,
    ]);
    assert.equal(
      await scalar("SELECT due_date FROM credit_card_bills WHERE id=$1", [bill]),
      "2026-09-12",
    );
    assert.equal(Number(await limit()), 100);
    assert.equal(
      Number(await scalar("SELECT get_financial_overview()->>'saldo_disponivel'")),
      1050,
    );
  });
  await check("editing and deleting card purchases reverse invoice and limit", async () => {
    await db.query("UPDATE transactions SET amount=80 WHERE id=$1", [purchase]);
    assert.equal(Number(await limit()), 80);
    const extra = await insertTx({ credit_card_id: card, amount: 15 });
    await db.query("DELETE FROM transactions WHERE id=$1", [extra]);
    assert.equal(Number(await limit()), 80);
    assert.equal(
      Number(await scalar("SELECT amount FROM credit_card_bills WHERE id=$1", [bill])),
      80,
    );
  });
  await check("closing date, next cycle, short months and year rollover", async () => {
    for (const [date, close, due, expected] of [
      ["2026-09-05", 5, 12, "2026-09-12"],
      ["2026-09-06", 5, 12, "2026-10-12"],
      ["2026-12-30", 25, 5, "2027-02-05"],
      ["2028-02-10", 15, 31, "2028-02-29"],
      ["2026-02-10", 15, 31, "2026-02-28"],
      ["2026-04-30", 31, 5, "2026-05-05"],
    ]) {
      assert.equal(await scalar("SELECT card_cycle_due($1,$2,$3)", [date, close, due]), expected);
    }
  });
  await check("installments conserve cents and reserve the full outstanding credit", async () => {
    const id = await insertTx({
      credit_card_id: card,
      amount: 100,
      installment_count: 3,
      occurred_at: "2026-09-06",
    });
    const items = await query(
      "SELECT installment_number,amount FROM credit_card_bill_items WHERE transaction_id=$1 ORDER BY installment_number",
      [id],
    );
    assert.deepEqual(
      items.map((i) => Number(i.amount)),
      [33.34, 33.33, 33.33],
    );
    assert.equal(Number(await limit()), 180);
    await db.query("DELETE FROM transactions WHERE id=$1", [id]);
    assert.equal(Number(await limit()), 80);
  });
  await check("payment requires payer; debits once; purchase is not counted twice", async () => {
    await reject("SELECT pay_credit_card_bill($1,null)", [bill], /conta pagadora/);
    await db.query("SELECT pay_credit_card_bill($1,$2)", [bill, account]);
    await db.query("SELECT pay_credit_card_bill($1,$2)", [bill, account]);
    assert.equal(
      Number(await scalar("SELECT count(*) FROM transactions WHERE flow='bill_payment'")),
      1,
    );
    assert.equal(Number(await limit()), 0);
    assert.equal(Number(await scalar("SELECT get_financial_overview()->>'saldo_disponivel'")), 970);
    assert.equal(
      Number(
        await scalar(
          "SELECT despesas FROM get_monthly_financial_summary('2026-01-01','2027-12-31')",
        ),
      ),
      80,
    );
    await reject("DELETE FROM transactions WHERE id=$1", [purchase], /Estorne/);
    await reject("UPDATE credit_card_bills SET manual_amount=1 WHERE id=$1", [bill], /paga/);
    await assert.rejects(() => insertTx({ credit_card_id: card, amount: 5 }), /Ciclo ja pago/);
  });
  await check("deleting payment reopens bill and restores cash and outstanding limit", async () => {
    await db.query("DELETE FROM transactions WHERE bill_id=$1 AND flow='bill_payment'", [bill]);
    assert.notEqual(
      await scalar("SELECT status FROM credit_card_bills WHERE id=$1", [bill]),
      "paga",
    );
    assert.equal(Number(await limit()), 80);
    assert.equal(
      Number(await scalar("SELECT get_financial_overview()->>'saldo_disponivel'")),
      1050,
    );
  });
  await check("cross-owner references and malformed transfers are rejected", async () => {
    await assert.rejects(() => insertTx({ account_id: foreignAccount }), /outro titular/);
    await assert.rejects(() => insertTx({ credit_card_id: foreignCard }), /outro titular/);
    await assert.rejects(
      () =>
        insertTx({ type: "transfer", account_id: account, destination_account_id: foreignAccount }),
      /outro titular/,
    );
    await assert.rejects(
      () => insertTx({ type: "transfer", account_id: account, destination_account_id: account }),
      /transactions_transfer_check/,
    );
    await assert.rejects(
      () =>
        insertTx({
          type: "transfer",
          account_id: account,
          destination_account_id: wallet,
          credit_card_id: card,
        }),
      /apenas contas/,
    );
    await assert.rejects(() => insertTx({ amount: -1 }), /positive_amount/);
  });
  await check("referenced accounts/cards cannot be deleted and lose history", async () => {
    await reject("DELETE FROM credit_cards WHERE id=$1", [card], /foreign key/);
    await reject("DELETE FROM accounts WHERE id=$1", [account], /foreign key/);
  });
  await check("manual invoice cannot overwrite generated invoice or mark it paid", async () => {
    await reject(
      "INSERT INTO credit_card_bills(user_id,card_id,month,year,due_date,manual_amount) VALUES ($1,$2,9,2026,'2026-09-12',50)",
      [uid, card],
      /unique/,
    );
    await db.query("UPDATE credit_card_bills SET status='paga' WHERE id=$1", [bill]);
    assert.notEqual(
      await scalar("SELECT status FROM credit_card_bills WHERE id=$1", [bill]),
      "paga",
    );
  });
  await check("shopping uses the same ledger and completion is idempotent", async () => {
    const item = await scalar(
      "INSERT INTO shopping_items(user_id,item,price,card_id,account_id,payment_method,installments,desired_date) VALUES ($1,'Planned',60,$2,$3,'credito_parcelado',2,'2026-09-06') RETURNING id",
      [uid, card, account],
    );
    const id = await scalar("SELECT complete_shopping_item($1,true)", [item]);
    assert.equal(await scalar("SELECT complete_shopping_item($1,true)", [item]), id);
    assert.equal(
      Number(
        await scalar("SELECT count(*) FROM credit_card_bill_items WHERE transaction_id=$1", [id]),
      ),
      2,
    );
    assert.equal(Number(await limit()), 140);
    assert.equal(
      Number(await scalar("SELECT get_financial_overview()->>'saldo_disponivel'")),
      1050,
    );
  });
  await check("shopping down payment debits cash and finances only the remainder", async () => {
    const before = Number((await balances()).find((a) => a.name === "Bank").balance);
    const item = await scalar(
      "INSERT INTO shopping_items(user_id,item,price,down_payment,card_id,account_id,payment_method,installments) VALUES ($1,'Planned with entry',100,20,$2,$3,'credito_parcelado',4) RETURNING id",
      [uid, card, account],
    );
    const tx = await scalar("SELECT complete_shopping_item($1,true,CURRENT_DATE)", [item]);
    const entry = await scalar(
      "SELECT down_payment_transaction_id FROM shopping_items WHERE id=$1",
      [item],
    );
    assert.equal(Number(await scalar("SELECT amount FROM transactions WHERE id=$1", [tx])), 80);
    assert.equal(Number(await scalar("SELECT amount FROM transactions WHERE id=$1", [entry])), 20);
    assert.equal(
      Number(
        await scalar("SELECT sum(amount) FROM credit_card_bill_items WHERE transaction_id=$1", [
          tx,
        ]),
      ),
      80,
    );
    assert.equal(Number((await balances()).find((a) => a.name === "Bank").balance), before - 20);
  });
  await check("direct credit, constraints and invalid investment values are rejected", async () => {
    await assert.rejects(() => insertTx({ payment_method: "credito" }), /exige cartao/);
    await reject(
      "INSERT INTO budgets(user_id,category_id,amount,month) VALUES ($1,$2,-1,'2026-09-01')",
      [uid, category],
      /budgets_amount_positive/,
    );
    const investment = await scalar(
      "INSERT INTO investments(user_id,name,invested_amount,current_amount,initial_amount) VALUES ($1,'CDB',100,100,100) RETURNING id",
      [uid],
    );
    await db.query(
      "SELECT update_investment_details($1,'CDB novo','cdb',null,120,125,100,CURRENT_DATE,null,'diaria','baixo',null,null,'ativo',false,'#000000')",
      [investment],
    );
    assert.equal(
      Number(await scalar("SELECT current_amount FROM investments WHERE id=$1", [investment])),
      125,
    );
    assert.equal(
      Number(
        await scalar(
          "SELECT count(*) FROM investment_events WHERE investment_id=$1 AND event_type='alteracao'",
          [investment],
        ),
      ),
      1,
    );
    await reject(
      "SELECT invest_update_value($1,-1,null)",
      [investment],
      /investments_amounts_nonnegative|valor/,
    );
  });
  await check("OCR save is atomic, idempotent and card-aware", async () => {
    const image = await scalar(
      "INSERT INTO uploaded_transaction_images(user_id,file_name,storage_path) VALUES ($1,'x.png',$2) RETURNING id",
      [uid, `${uid}/x.png`],
    );
    const detected = await scalar(
      "INSERT INTO ocr_detected_transactions(user_id,image_id,detected_amount,detected_type) VALUES ($1,$2,25,'expense') RETURNING id",
      [uid, image],
    );
    const tx = await scalar(
      "SELECT save_ocr_detected_transaction($1,CURRENT_DATE,25,'expense','OCR',null,null,'credito',$2)",
      [detected, card],
    );
    assert.equal(
      await scalar(
        "SELECT save_ocr_detected_transaction($1,CURRENT_DATE,25,'expense','OCR',null,null,'credito',$2)",
        [detected, card],
      ),
      tx,
    );
    assert.equal(Number(await scalar("SELECT count(*) FROM transactions WHERE id=$1", [tx])), 1);
    assert.equal(
      Number(
        await scalar("SELECT count(*) FROM credit_card_bill_items WHERE transaction_id=$1", [tx]),
      ),
      1,
    );
  });
  await check("viewer access requires target acceptance and can be left safely", async () => {
    assert.equal(await scalar("SELECT grant_viewer_access('other@example.com')"), "pending");
    const invitation = await scalar(
      "SELECT id FROM viewer_invitations WHERE owner_id=$1 AND target_user_id=$2 AND status='pending'",
      [uid, other],
    );
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false);`);
    assert.equal(
      await scalar("SELECT role::text FROM user_roles WHERE user_id=$1", [other]),
      "admin",
    );
    assert.equal(await scalar("SELECT accept_viewer_access($1)", [invitation]), "ok");
    assert.equal(
      await scalar("SELECT role::text FROM user_roles WHERE user_id=$1", [other]),
      "viewer",
    );
    assert.equal(await scalar("SELECT leave_viewer_access()"), "ok");
    assert.equal(
      await scalar("SELECT role::text FROM user_roles WHERE user_id=$1", [other]),
      "admin",
    );
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid}',false);`);
  });
  await check(
    "cash history excludes card purchases and transfers but includes the cash entry",
    async () => {
      const extras = await scalar("SELECT get_statistics_extras('2026-09-01','2026-09-30')");
      assert.equal(Number(extras.opening_balance), 1050);
      assert.equal(Number(extras.cash_series[0].net), -20);
    },
  );
  await check("viewer reads owner data but cannot mutate ledger or payment", async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false);`);
    assert.equal(Number(await scalar("SELECT count(*) FROM accounts")), 2);
    assert.ok(Number(await scalar("SELECT count(*) FROM credit_card_bill_items")) > 0);
    await assert.rejects(
      () => insertTx({ user_id: viewer, account_id: account }),
      /outro titular|row-level/,
    );
    await reject("SELECT pay_credit_card_bill($1,$2)", [bill, account], /Administrador/);
    await reject("DELETE FROM credit_card_bill_items", [], /permission denied/);
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false);`);
    assert.equal(Number(await scalar("SELECT count(*) FROM credit_card_bill_items")), 0);
  });
  await check("cron can still generate non-card recurring transactions without JWT", async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.query(
      "INSERT INTO recurring_expenses(user_id,name,amount,account_id,billing_day,start_date,payment_method) VALUES ($1,'Recurring',10,$2,EXTRACT(DAY FROM CURRENT_DATE),CURRENT_DATE-INTERVAL '1 year','pix')",
      [uid, account],
    );
    await db.query(
      "INSERT INTO recurring_expenses(user_id,name,amount,credit_card_id,billing_day,start_date,payment_method) VALUES ($1,'Recurring card',12.34,$2,EXTRACT(DAY FROM CURRENT_DATE),CURRENT_DATE-INTERVAL '1 year','credito')",
      [other, foreignCard],
    );
    await db.query("SELECT private.run_financial_daily_maintenance()");
    assert.equal(
      Number(await scalar("SELECT count(*) FROM transactions WHERE recurring_id IS NOT NULL")),
      2,
    );
    const recurringCardTx = await scalar(
      "SELECT id FROM transactions WHERE description='Recurring card'",
    );
    assert.equal(
      await scalar("SELECT credit_card_id FROM transactions WHERE id=$1", [recurringCardTx]),
      foreignCard,
    );
    assert.equal(
      Number(
        await scalar("SELECT count(*) FROM credit_card_bill_items WHERE transaction_id=$1", [
          recurringCardTx,
        ]),
      ),
      1,
    );
  });
  console.log(`${passed} financial integration checks passed.`);
} finally {
  await db.close();
}
