import assert from "node:assert/strict";
import { createInvestmentDb } from "./helpers/investment-test-db.mjs";
const keepAlive = setInterval(() => {}, 1000);
const db = await createInvestmentDb();
const owner = "00000000-0000-4000-8000-000000000021",
  other = "00000000-0000-4000-8000-000000000022",
  viewer = "00000000-0000-4000-8000-000000000023";
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
let checks = 0;
const check = async (label, fn) => {
  await fn();
  checks++;
  console.log("PASS", label);
};
const reject = (sql, args, rx) => assert.rejects(() => db.query(sql, args), rx);
const latest = async () => (await one("SELECT get_financial_history()")).rows[0].id;
const portfolio = () => one("SELECT get_investment_portfolio()");
const global = () => one("SELECT get_global_wallet()");
const details = {
  name: "PETR4",
  inv_type: "acoes",
  institution: "XP",
  invested_amount: 100,
  current_amount: 100,
  initial_amount: 100,
  applied_at: "2026-10-05",
  maturity_date: null,
  liquidity: "d1",
  risk: "alto",
  objective: null,
  notes: null,
  status: "ativo",
  is_emergency_reserve: false,
  color: "#34d399",
};
const asAdmin = () => db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);`);
const asOwner = () =>
  db.exec(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);`);
const accept = async (price) => {
  await asAdmin();
  await db.query("SELECT private.accept_investment_quote('brapi','PETR4',$1,clock_timestamp())", [
    price,
  ]);
  await asOwner();
};
try {
  await db.exec(
    `INSERT INTO auth.users(id,email) VALUES('${owner}','one@test'),('${other}','two@test'),('${viewer}','viewer@test');INSERT INTO profiles(id) VALUES('${owner}'),('${other}'),('${viewer}');INSERT INTO user_roles(user_id,role,owner_id) VALUES('${owner}','admin',null),('${other}','admin',null),('${viewer}','viewer','${owner}');`,
  );
  const account = await one(
    "INSERT INTO accounts(user_id,name,type,initial_balance) VALUES($1,'Banco','digital_bank',1000) RETURNING id",
    [owner],
  );
  const cash = await one(
    "INSERT INTO accounts(user_id,name,type,initial_balance) VALUES($1,'Fisica','cash',200) RETURNING id",
    [owner],
  );
  await asOwner();
  let inv = await one("SELECT save_investment_position(null,$1,'brapi','petr4',10)", [details]);
  await check(
    "position normalizes asset identity and saves atomically with reversible metadata",
    async () => {
      assert.equal((await portfolio()).rows[0].asset_code, "PETR4");
      assert.equal(
        (await one("SELECT get_financial_action($1)", [await latest()])).changes.length,
        2,
      );
      await reject(
        "SELECT save_investment_position(null,$1,'brapi','INVALID/?',10)",
        [details],
        /Identificador/,
      );
      assert.equal((await portfolio()).rows.length, 1);
    },
  );
  await check("global counts available funds and investment capital once", async () => {
    const g = await global();
    assert.equal(g.overview.saldo_disponivel, 1200);
    assert.equal(g.overview.patrimonio_total, 1300);
    assert.equal(g.investment_summary.value, 100);
    assert.equal(g.unassigned_balance, 0);
  });
  await check(
    "30-minute queue sends one request per shared asset, repeated refresh is cached",
    async () => {
      assert.equal((await one("SELECT refresh_investment_quotes()")).queued, 1);
      assert.equal((await one("SELECT refresh_investment_quotes()")).queued, 0);
      await asAdmin();
      assert.equal(await one("SELECT count(*) FROM net.http_request_queue"), 1);
      const req = (await q("SELECT * FROM net.http_request_queue"))[0];
      assert.equal(req.url, "https://brapi.dev/api/v2/stocks/quote");
      assert.deepEqual(req.params, { symbols: "PETR4" });
      await db.query("INSERT INTO net._http_response VALUES($1,200,$2,false)", [
        req.id,
        JSON.stringify({
          results: [
            {
              requestedSymbol: "PETR4",
              symbol: "PETR4",
              data: {
                currency: "BRL",
                regularMarketPrice: 12,
                regularMarketTime: new Date().toISOString(),
              },
            },
          ],
        }),
      ]);
      assert.equal(await one("SELECT private.collect_investment_quotes()"), 1);
      await asOwner();
      assert.equal((await portfolio()).rows[0].current_amount, 120);
      assert.equal((await global()).overview.patrimonio_total, 1320);
    },
  );
  await check(
    "market valuation changes no account balance and creates no financial action",
    async () => {
      const before = await latest();
      await accept(10);
      assert.equal(await latest(), before);
      assert.equal((await global()).overview.saldo_disponivel, 1200);
    },
  );
  let purchase;
  await check(
    "purchase moves capital from account to units without classifying consumption",
    async () => {
      await db.query("SELECT invest_move_position($1,'aporte',50,CURRENT_DATE,$2,5,'Compra')", [
        inv,
        account,
      ]);
      purchase = await latest();
      const g = await global();
      assert.equal(g.overview.saldo_disponivel, 1150);
      assert.equal(g.overview.patrimonio_total, 1300);
      assert.equal(g.overview.gastos_reais_mes, 0);
      assert.equal(g.overview.aportes_mes, 50);
      assert.equal((await portfolio()).rows[0].quantity, 15);
    },
  );
  await check(
    "undo purchase restores units and account even after a newer market price",
    async () => {
      await accept(20);
      assert.equal((await global()).overview.patrimonio_total, 1450);
      assert.equal(
        (await one("SELECT revert_financial_action($1)", [purchase])).status,
        "reverted",
      );
      const g = await global();
      assert.equal(g.overview.saldo_disponivel, 1200);
      assert.equal(g.overview.patrimonio_total, 1400);
      assert.equal((await portfolio()).rows[0].quantity, 10);
      assert.equal(
        (await one("SELECT revert_financial_action($1)", [purchase])).status,
        "already_reverted",
      );
    },
  );
  await check(
    "sale reduces cost proportionally and routes proceeds to selected account",
    async () => {
      await db.query("SELECT invest_move_position($1,'resgate',100,CURRENT_DATE,$2,5,'Venda')", [
        inv,
        account,
      ]);
      const p = await portfolio(),
        g = await global();
      assert.equal(p.rows[0].quantity, 5);
      assert.equal(p.rows[0].invested_amount, 50);
      assert.equal(p.summary.profit, 50);
      assert.equal(g.overview.saldo_disponivel, 1300);
      assert.equal(g.overview.patrimonio_total, 1400);
      assert.equal(g.overview.receitas_reais_mes, 0);
      assert.equal(
        (await one("SELECT revert_financial_action($1)", [await latest()])).status,
        "reverted",
      );
    },
  );
  await check(
    "invalid trades and old clients cannot silently change quoted position quantities",
    async () => {
      await reject(
        "SELECT invest_move_position($1,'resgate',500,CURRENT_DATE,$2,20,null)",
        [inv, account],
        /Quantidade/,
      );
      await reject(
        "SELECT invest_move_position($1,'aporte',50,CURRENT_DATE,null,5,null)",
        [inv],
        /conta/,
      );
      await reject(
        "SELECT invest_move_position($1,'aporte',50,CURRENT_DATE,$2,null,null)",
        [inv, account],
        /quantidade/,
      );
      await reject(
        "SELECT invest_contribute($1,50,CURRENT_DATE,$2,null)",
        [inv, account],
        /quantidade/,
      );
      await reject("SELECT invest_update_value($1,999,null)", [inv], /quantidade/);
      assert.equal((await portfolio()).rows[0].quantity, 10);
    },
  );
  await check(
    "manual holdings remain visible and partial redemption preserves remaining cost",
    async () => {
      const manual = await one("SELECT save_investment_position(null,$1,'manual',null,null)", [
        { ...details, name: "CDB", inv_type: "cdb", current_amount: 120 },
      ]);
      await db.query("SELECT invest_move_position($1,'resgate',60,CURRENT_DATE,$2,null,null)", [
        manual,
        cash,
      ]);
      const p = (await portfolio()).rows.find((i) => i.id === manual);
      assert.equal(p.current_amount, 60);
      assert.equal(p.invested_amount, 50);
      assert.equal(p.valuation_status, "manual");
    },
  );
  await check(
    "configuration and tracked holding deletion are reversible without touching quote cache",
    async () => {
      await db.query("DELETE FROM investments WHERE id=$1", [inv]);
      assert.equal(
        (await one("SELECT revert_financial_action($1)", [await latest()])).status,
        "reverted",
      );
      assert.equal((await portfolio()).rows.find((i) => i.id === inv).quantity, 10);
      await db.query("SELECT save_investment_position($1,$2,'manual',null,null)", [inv, details]);
      assert.equal(
        (await one("SELECT revert_financial_action($1)", [await latest()])).status,
        "reverted",
      );
      assert.equal((await portfolio()).rows.find((i) => i.id === inv).current_amount, 200);
    },
  );
  await check(
    "unavailable source preserves last valid quote and records a visible failure",
    async () => {
      await asAdmin();
      await db.exec(
        "UPDATE private.investment_quotes SET attempted_at=now()-interval '31 minutes';SELECT private.queue_investment_quotes();",
      );
      const req = await one("SELECT max(request_id) FROM private.investment_quote_requests");
      await db.query("INSERT INTO net._http_response VALUES($1,429,null,false)", [req]);
      await db.exec("SELECT private.collect_investment_quotes()");
      await asOwner();
      const p = (await portfolio()).rows.find((i) => i.id === inv);
      assert.equal(p.current_amount, 200);
      assert.equal(p.valuation_status, "error");
      assert.match(p.quote_error, /Limite/);
    },
  );
  await check(
    "invalid, future, missing and out-of-order prices never overwrite latest valid quote",
    async () => {
      await asAdmin();
      for (const [price, date] of [
        [0, new Date().toISOString()],
        [-1, new Date().toISOString()],
        [10, "2099-01-01"],
        [null, new Date().toISOString()],
        ["NaN", new Date().toISOString()],
      ])
        await reject(
          "SELECT private.accept_investment_quote('brapi','PETR4',$1,$2)",
          [price, date],
          /Cotacao invalida/,
        );
      await db.query(
        "SELECT private.accept_investment_quote('brapi','PETR4',1,now()-interval '1 hour')",
      );
      assert.equal(
        Number(await one("SELECT price FROM private.investment_quotes WHERE asset_code='PETR4'")),
        20,
      );
      await asOwner();
    },
  );
  await check(
    "unsupported keyless asset reports configuration requirement instead of invented values",
    async () => {
      const id = await one("SELECT save_investment_position(null,$1,'brapi','WEGE3',10)", [
        { ...details, name: "WEGE3" },
      ]);
      assert.equal((await one("SELECT refresh_investment_quotes()")).queued, 0);
      const p = (await portfolio()).rows.find((i) => i.id === id);
      assert.equal(p.valuation_status, "pending");
      assert.match(p.quote_error, /chave/);
      assert.equal(p.current_amount, 100);
    },
  );
  await check(
    "source credentials are write-only, own provider status never returns a token",
    async () => {
      await db.query("SELECT configure_investment_provider('coingecko','test-key')");
      assert.deepEqual(await one("SELECT get_investment_provider_status()"), {
        brapi: false,
        coingecko: true,
      });
      await reject("SELECT * FROM private.investment_credentials", [], /permission denied/);
      await reject("SELECT * FROM vault.decrypted_secrets", [], /permission denied/);
      await db.query("SELECT configure_investment_provider('coingecko','')");
      assert.equal((await one("SELECT get_investment_provider_status()")).coingecko, false);
    },
  );
  await check(
    "chart history returns actual unit prices with no fabricated earlier points",
    async () => {
      const h = await one("SELECT get_investment_price_history($1)", [inv]);
      assert.equal(h.length, 1);
      assert.equal(h[0].price, 20);
    },
  );
  await check(
    "viewer reads owner valuations and global wallet but cannot mutate or refresh",
    async () => {
      const expected = await global();
      await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false)`);
      assert.deepEqual(await global(), expected);
      await reject("SELECT refresh_investment_quotes()", [], /Administrador/);
      await reject("SELECT configure_investment_provider('brapi','abc')", [], /Administrador/);
      await reject(
        "SELECT invest_move_position($1,'aporte',10,CURRENT_DATE,$2,1,null)",
        [inv, account],
        /Administrador/,
      );
      await reject(
        "UPDATE investment_tracking SET quantity=999 WHERE investment_id=$1",
        [inv],
        /permission denied/,
      );
      await asOwner();
    },
  );
  await check("other owners cannot read price history or alter someone else position", async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false)`);
    assert.equal((await portfolio()).rows.length, 0);
    assert.deepEqual(await one("SELECT get_investment_price_history($1)", [inv]), []);
    await reject(
      "SELECT save_investment_position($1,$2,'manual',null,null)",
      [inv, details],
      /encontrado/,
    );
    await asOwner();
  });
  await check(
    "card limits, expected recharges and reserved goals never add duplicate capital",
    async () => {
      const before = (await global()).overview.patrimonio_total;
      await db.query(
        "INSERT INTO credit_cards(user_id,name,total_limit,closing_day,due_day) VALUES($1,'Cartao',10000,20,5)",
        [owner],
      );
      await db.query(
        "INSERT INTO balance_recharges(user_id,name,expected_amount,expected_date,status) VALUES($1,'Prevista',700,CURRENT_DATE,'prevista')",
        [owner],
      );
      await db.query(
        "INSERT INTO goals(user_id,name,target_amount,current_amount) VALUES($1,'Meta',1000,100)",
        [owner],
      );
      assert.equal((await global()).overview.patrimonio_total, before);
    },
  );
  await check(
    "scheduler installs market fetch every 30 minutes and response collector every two",
    async () => {
      await asAdmin();
      assert.deepEqual(
        (await q("SELECT jobname,schedule FROM cron.job ORDER BY jobname")).map((x) => x.schedule),
        ["*/30 * * * *", "*/2 * * * *"],
      );
    },
  );
  await check(
    "portfolio valuation snapshots match holdings and never invent prior dates",
    async () => {
      await asAdmin();
      await db.exec("SELECT private.capture_investment_valuations()");
      await asOwner();
      const h = await one("SELECT get_investment_valuation_history()"),
        p = await portfolio();
      assert.equal(h.length, 1);
      assert.equal(h[0].value, p.summary.value);
      assert.equal(h[0].invested, p.summary.invested);
      assert.equal(h[0].manual_count, p.summary.manual_count);
    },
  );
  await check(
    "valuation snapshots are separate from financial actions and deduplicate 30-minute window",
    async () => {
      const action = await latest();
      await asAdmin();
      await db.exec(
        "SELECT private.capture_investment_valuations();SELECT private.capture_investment_valuations()",
      );
      assert.equal(await one("SELECT count(*) FROM private.investment_valuation_history"), 1);
      await asOwner();
      assert.equal(await latest(), action);
    },
  );
  await check("valuation history shares with viewer and isolates unrelated owners", async () => {
    const h = await one("SELECT get_investment_valuation_history()");
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${viewer}',false)`);
    assert.deepEqual(await one("SELECT get_investment_valuation_history()"), h);
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false)`);
    assert.deepEqual(await one("SELECT get_investment_valuation_history()"), []);
    await asOwner();
  });
  console.log(`${checks} investment wallet integration checks passed`);
} finally {
  await db.close();
  clearInterval(keepAlive);
}
