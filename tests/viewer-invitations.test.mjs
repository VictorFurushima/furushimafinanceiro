import assert from "node:assert/strict";
import { createInvestmentDb } from "./helpers/investment-test-db.mjs";

const keepAlive = setInterval(() => {}, 1000);
const db = await createInvestmentDb();
const owner = "00000000-0000-4000-8000-000000000041",
  guest = "00000000-0000-4000-8000-000000000042",
  stranger = "00000000-0000-4000-8000-000000000043";
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
const as = (id) =>
  db.exec(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id}',false);`);
let checks = 0;
const check = async (label, fn) => {
  await fn();
  checks++;
  console.log("PASS", label);
};
try {
  await db.exec(`INSERT INTO auth.users(id,email) VALUES('${owner}','titular@test'),('${guest}','convidado@test'),('${stranger}','outro@test');
    INSERT INTO user_roles(user_id,role,owner_id) VALUES('${owner}','admin',null),('${guest}','admin',null),('${stranger}','admin',null);`);

  await check("authenticated cannot read auth.users directly", async () => {
    await as(guest);
    await assert.rejects(() => db.query("SELECT email FROM auth.users"), /permission denied/);
  });

  await check("invited user lists the pending invitation with the owner e-mail", async () => {
    await as(owner);
    assert.equal(await one("SELECT grant_viewer_access('convidado@test')"), "pending");
    await as(guest);
    const rows = await q("SELECT owner_email FROM list_my_viewer_invitations()");
    assert.deepEqual(
      rows.map((r) => r.owner_email),
      ["titular@test"],
    );
  });

  await check("other users never see someone else's invitation", async () => {
    await as(stranger);
    assert.deepEqual(await q("SELECT * FROM list_my_viewer_invitations()"), []);
    await as(owner);
    assert.deepEqual(await q("SELECT * FROM list_my_viewer_invitations()"), []);
  });

  await check("accepting turns the guest into viewer and clears the list", async () => {
    await as(guest);
    const id = await one("SELECT id FROM list_my_viewer_invitations()");
    assert.equal(await one("SELECT accept_viewer_access($1)", [id]), "ok");
    assert.equal(await one("SELECT space_owner($1)", [guest]), owner);
    assert.deepEqual(await q("SELECT * FROM list_my_viewer_invitations()"), []);
  });

  await check("anonymous callers cannot execute the listing", async () => {
    await db.exec("RESET ROLE;SET ROLE anon;");
    await assert.rejects(
      () => db.query("SELECT * FROM list_my_viewer_invitations()"),
      /permission denied/,
    );
  });
  console.log(`${checks} viewer invitation checks passed`);
} finally {
  await db.close();
  clearInterval(keepAlive);
}
