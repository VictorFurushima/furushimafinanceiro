import assert from "node:assert/strict";
import { createInvestmentDb } from "./helpers/investment-test-db.mjs";

const keepAlive = setInterval(() => {}, 1000);
const db = await createInvestmentDb();
const owner = "00000000-0000-4000-8000-000000000031",
  viewer = "00000000-0000-4000-8000-000000000033";
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => {
  const v = Object.values((await q(sql, args))[0])[0];
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
};
let checks = 0;
const check = async (label, fn) => {
  await fn();
  checks++;
  console.log("PASS", label);
};
// Cron e manutencao rodam sem JWT; o titular usa o papel authenticated.
const asCron = () => db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);`);
const asUser = (id) =>
  db.exec(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id}',false);`);
const maintenance = () => one("SELECT private.run_financial_daily_maintenance()");
// Datas de referencia sempre no dia de Sao Paulo, como o app.
const SP_TODAY = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const today = await one(`SELECT ${SP_TODAY}::text`);
const monthStart = await one(`SELECT date_trunc('month',${SP_TODAY})::date::text`);
const prevMonth = await one(
  `SELECT (date_trunc('month',${SP_TODAY})-interval '1 month')::date::text`,
);
const nextMonth = await one(
  `SELECT (date_trunc('month',${SP_TODAY})+interval '1 month')::date::text`,
);
const isFirstDay = today === monthStart;

const TIMEZONE_FUNCTIONS = [
  "private.run_financial_daily_maintenance()",
  "public.generate_recurring_transactions()",
  "public.generate_recurring_recharges()",
  "public.mark_overdue_recharges()",
  "public.get_financial_overview()",
  "public.get_dashboard_snapshot()",
  "public.get_dashboard_bundle(integer)",
  "public.get_monthly_series(integer)",
  "public.pay_credit_card_bill(uuid,uuid)",
  "public.confirm_recharge_as_income(uuid)",
  "public.validate_bill()",
  "public.invest_update_value(uuid,numeric,text)",
  "public.update_investment_details(uuid,text,text,text,numeric,numeric,numeric,date,date,text,text,text,text,text,boolean,text)",
];
const HISTORY_FUNCTIONS = [
  "private.capture_financial_action()",
  "private.financial_action_conflicts(uuid)",
  "public.revert_financial_action(uuid)",
];
const latestAction = async () => (await one("SELECT get_financial_history()")).rows[0].id;

try {
  await db.exec(
    `INSERT INTO auth.users(id,email) VALUES('${owner}','owner@test'),('${viewer}','viewer@test');
     INSERT INTO profiles(id) VALUES('${owner}'),('${viewer}');
     INSERT INTO user_roles(user_id,role,owner_id) VALUES('${owner}','admin',null),('${viewer}','viewer','${owner}');`,
  );
  const account = await one(
    "INSERT INTO accounts(user_id,name,type,initial_balance) VALUES($1,'Banco','digital_bank',5000) RETURNING id",
    [owner],
  );
  const card = await one(
    "INSERT INTO credit_cards(user_id,name,total_limit,closing_day,due_day) VALUES($1,'Cartao',5000,5,12) RETURNING id",
    [owner],
  );
  const recharge = (fields) =>
    one(
      `INSERT INTO balance_recharges(user_id,name,recharge_type,expected_amount,expected_date,account_id,status,is_recurring,recurring_day)
       VALUES($1,$2,'fixed_income',$3,$4::date,$5,$6,$7,$8) RETURNING id`,
      [
        owner,
        fields.name,
        fields.amount ?? 1000,
        fields.date,
        account,
        fields.status ?? "prevista",
        fields.recurring ?? true,
        fields.day ?? null,
      ],
    );
  const children = (template) =>
    q(
      "SELECT expected_date::text AS d,status FROM balance_recharges WHERE source_recharge_id=$1 ORDER BY expected_date",
      [template],
    );
  const subscription = (fields) =>
    one(
      `INSERT INTO recurring_expenses(user_id,name,amount,account_id,billing_day,frequency,start_date,end_date,payment_method,status)
       VALUES($1,$2,$3,$4,$5,$6,$7::date,$8::date,'pix','active') RETURNING id`,
      [
        owner,
        fields.name,
        fields.amount ?? 10,
        account,
        fields.day,
        fields.frequency ?? "monthly",
        fields.start,
        fields.end ?? null,
      ],
    );
  const launched = (id) =>
    q("SELECT occurred_at::text AS d FROM transactions WHERE recurring_id=$1 ORDER BY 1", [id]);

  await check("financial functions pin Sao Paulo and history pins UTC", async () => {
    const zoneOf = (signature) =>
      one("SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure", [signature]);
    for (const signature of TIMEZONE_FUNCTIONS) {
      const config = await zoneOf(signature);
      assert.ok(
        (config ?? []).includes("TimeZone=America/Sao_Paulo"),
        `${signature} sem fuso: ${config}`,
      );
    }
    for (const signature of HISTORY_FUNCTIONS) {
      const config = await zoneOf(signature);
      assert.ok((config ?? []).includes("TimeZone=UTC"), `${signature} sem UTC: ${config}`);
    }
  });

  await check("recurring recharge template is the first occurrence of its own month", async () => {
    await asCron();
    const current = await recharge({ name: "Salario atual", date: today, status: "confirmada" });
    await maintenance();
    assert.deepEqual(await children(current), []);
    await maintenance();
    assert.deepEqual(await children(current), [], "repeticao continua sem copia");
    assert.equal(
      Number(
        await one(
          "SELECT count(*) FROM balance_recharges WHERE name='Salario atual' AND status<>'cancelada'",
        ),
      ),
      1,
    );
  });

  await check("future template never creates copies before it starts", async () => {
    const future = await recharge({ name: "Bonus futuro", date: nextMonth, day: 1 });
    await maintenance();
    assert.deepEqual(await children(future), []);
  });

  await check("template from a previous month creates exactly one copy this month", async () => {
    const previous = await recharge({ name: "Salario anterior", date: prevMonth, day: 31 });
    await maintenance();
    await maintenance();
    const rows = await children(previous);
    assert.equal(rows.length, 1);
    const expected = await one(
      `SELECT (date_trunc('month',${SP_TODAY})+interval '1 month - 1 day')::date::text`,
    );
    assert.equal(rows[0].d, expected, "dia 31 limitado ao ultimo dia do mes");
    assert.equal(rows[0].status, "prevista");
  });

  await check("legacy client generator follows the same recharge rule", async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${owner}',false);`);
    const current = await recharge({ name: "Freela atual", date: today });
    assert.equal(Number(await one("SELECT public.generate_recurring_recharges()")), 0);
    assert.deepEqual(await children(current), []);
    await asCron();
  });

  await check(
    "subscription created after its billing day is not charged retroactively",
    async () => {
      const late = await subscription({ name: "Streaming novo", day: 1, start: today });
      await maintenance();
      assert.deepEqual(
        (await launched(late)).map((r) => r.d),
        isFirstDay ? [today] : [],
      );
      const yearly = await subscription({
        name: "Anuidade nova",
        day: 1,
        frequency: "yearly",
        start: today,
      });
      await maintenance();
      assert.deepEqual(
        (await launched(yearly)).map((r) => r.d),
        isFirstDay ? [today] : [],
      );
    },
  );

  await check("subscription that started earlier is still charged once this month", async () => {
    const running = await subscription({ name: "Academia", day: 1, start: prevMonth });
    await maintenance();
    await maintenance();
    assert.deepEqual(
      (await launched(running)).map((r) => r.d),
      [monthStart],
    );
    const weekly = await subscription({
      name: "Feira semanal",
      day: 1,
      frequency: "weekly",
      start: prevMonth,
    });
    await maintenance();
    const [row] = await launched(weekly);
    assert.ok(row && row.d <= today && row.d >= prevMonth, "ocorrencia semanal mais recente");
  });

  await check("legacy custom frequency has no schedule and is never generated", async () => {
    const custom = await subscription({
      name: "Personalizada",
      day: 1,
      frequency: "custom",
      start: prevMonth,
    });
    await maintenance();
    await maintenance();
    assert.deepEqual(await launched(custom), []);
  });

  await check(
    "viewer cannot trigger generation and owner client RPC stays idempotent",
    async () => {
      await subscription({ name: "Revista", day: 1, start: prevMonth });
      await asUser(viewer);
      assert.equal(Number(await one("SELECT public.generate_recurring_transactions()")), 0);
      await asUser(owner);
      const first = Number(await one("SELECT public.generate_recurring_transactions()"));
      assert.equal(first, 1);
      assert.equal(Number(await one("SELECT public.generate_recurring_transactions()")), 0);
    },
  );

  await check(
    "bill payment and income use the Sao Paulo day and stay reversible in any session timezone",
    async () => {
      // Escolhe um fuso de sessao cujo "hoje" difere do dia de Sao Paulo neste instante.
      let sessionZone = null;
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
        const differs = await one(`SELECT (now() AT TIME ZONE $1)::date <> ${SP_TODAY}`, [zone]);
        if (differs) sessionZone = zone;
      }
      assert.ok(sessionZone, "ha sempre um fuso de sessao com outro dia");
      await asUser(owner);
      await one(
        "INSERT INTO transactions(user_id,type,amount,occurred_at,credit_card_id,description) VALUES($1,'expense',100,$2::date,$3,'Compra') RETURNING id",
        [owner, today, card],
      );
      const bill = await one(
        "SELECT i.bill_id FROM credit_card_bill_items i JOIN transactions t ON t.id=i.transaction_id WHERE t.description='Compra'",
      );
      const income = await recharge({ name: "Reembolso", date: today, recurring: false });
      await db.exec(`SET TIME ZONE '${sessionZone}'`);
      try {
        const sessionDay = await one("SELECT CURRENT_DATE::text");
        assert.notEqual(sessionDay, today);
        await db.query("SELECT pay_credit_card_bill($1,$2)", [bill, account]);
        const payAction = await latestAction();
        assert.equal(
          await one(
            "SELECT occurred_at::text FROM transactions WHERE bill_id=$1 AND flow='bill_payment'",
            [bill],
          ),
          today,
        );
        assert.equal(
          await one("SELECT payment_date::text FROM credit_card_bills WHERE id=$1", [bill]),
          today,
        );
        const tx = await one("SELECT confirm_recharge_as_income($1)", [income]);
        assert.equal(
          await one("SELECT occurred_at::text FROM transactions WHERE id=$1", [tx]),
          today,
        );
        const confirmAction = await latestAction();
        const overview = await one("SELECT get_financial_overview()");
        assert.ok(Number(overview.gastos_reais_mes) >= 100, "mes corrente no fuso de Sao Paulo");
        // Historico guarda snapshots em UTC: desfazer segue possivel em qualquer fuso de sessao.
        const undo = (id) => one("SELECT revert_financial_action($1)", [id]);
        assert.equal((await undo(confirmAction)).status, "reverted");
        assert.equal((await undo(payAction)).status, "reverted");
        assert.notEqual(
          await one("SELECT status FROM credit_card_bills WHERE id=$1", [bill]),
          "paga",
        );
      } finally {
        await db.exec("SET TIME ZONE 'UTC'");
      }
    },
  );

  console.log(`${checks} recurrence and timezone checks passed`);
} finally {
  await db.close();
  clearInterval(keepAlive);
}
