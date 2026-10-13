// Emulador local do Supabase para testes ponta a ponta do app.
// Auth (senha), PostgREST (select com embed, filtros, ordem, contagem, insert/upsert/update/delete),
// RPC e Storage do bucket de prints. Banco: PGlite com as migrations reais do projeto.
// Cada requisicao roda em transacao com o papel authenticated/anon e o sub do JWT, como no Supabase,
// entao RLS, triggers e grants valem exatamente como em producao. A IA do OCR nao e emulada.
import { createServer } from "node:http";
import { createInvestmentDb } from "../helpers/investment-test-db.mjs";

const IDENT = /^[a-z_][a-z0-9_]*$/;
// Mesma serializacao do PostgREST: numeric como numero, date como "AAAA-MM-DD", timestamptz ISO.
const PARSERS = {
  1700: (v) => Number(v),
  1082: (v) => v,
  1114: (v) => v.replace(" ", "T"),
  1184: (v) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"),
};
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");

export function makeJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
  };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.local-e2e-signature`;
}

function decodeJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload?.sub && payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

function splitTop(text, sep = ",") {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const ident = (name) => {
  if (!IDENT.test(name)) throw httpError(400, "PGRST100", `Identificador invalido: ${name}`);
  return `"${name}"`;
};

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function startEmulator({ port = 54321, seed } = {}) {
  const db = await createInvestmentDb();
  const users = new Map(); // email -> {id,email,password}
  const files = new Map(); // bucket/path -> {bytes, type, owner}
  const requests = []; // log de chamadas com erro
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const fkCache = new Map();
  async function relation(base, rel, hint) {
    const key = `${base}>${rel}>${hint ?? ""}`;
    if (fkCache.has(key)) return fkCache.get(key);
    const rows = (
      await db.query(
        `SELECT c.conname, cl.relname AS src, a.attname AS src_col, rl.relname AS dst, ra.attname AS dst_col
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname='public'
         JOIN pg_class rl ON rl.oid=c.confrelid
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
         JOIN pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=c.confkey[1]
         WHERE c.contype='f' AND array_length(c.conkey,1)=1
           AND ((cl.relname=$1 AND rl.relname=$2) OR (cl.relname=$2 AND rl.relname=$1))`,
        [base, rel],
      )
    ).rows.filter((r) => !hint || r.conname === hint);
    const toOne = rows.find((r) => r.src === base && r.dst === rel);
    const toMany = rows.find((r) => r.src === rel && r.dst === base);
    const found = toOne
      ? { kind: "one", local: toOne.src_col, remote: toOne.dst_col }
      : toMany
        ? { kind: "many", local: toMany.dst_col, remote: toMany.src_col }
        : null;
    if (!found) throw httpError(400, "PGRST200", `Relacao ${base}->${rel} nao encontrada`);
    fkCache.set(key, found);
    return found;
  }

  async function selectList(table, select, alias = "_t") {
    const items = splitTop(select || "*");
    const parts = [];
    for (const item of items) {
      const embed = item.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s);
      if (embed) {
        const [, as, rel, hint, inner] = embed;
        const r = await relation(table, rel, hint);
        const innerCols = await selectList(rel, inner, "_e");
        const sub =
          r.kind === "one"
            ? `(SELECT to_jsonb(_x) FROM (SELECT ${innerCols} FROM public.${ident(rel)} _e WHERE _e.${ident(r.remote)}=${alias}.${ident(r.local)}) _x)`
            : `(SELECT coalesce(jsonb_agg(to_jsonb(_x)),'[]'::jsonb) FROM (SELECT ${innerCols} FROM public.${ident(rel)} _e WHERE _e.${ident(r.remote)}=${alias}.${ident(r.local)}) _x)`;
        parts.push(`${sub} AS ${ident(as ?? rel)}`);
      } else if (item === "*") parts.push(`${alias}.*`);
      else {
        const col = item.match(/^(?:(\w+):)?(\w+)$/);
        if (!col) throw httpError(400, "PGRST100", `Select nao suportado: ${item}`);
        parts.push(`${alias}.${ident(col[2])}${col[1] ? ` AS ${ident(col[1])}` : ""}`);
      }
    }
    return parts.join(", ");
  }

  const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
  function whereClause(params, args, alias = "_t") {
    const conds = [];
    for (const [key, raw] of params) {
      if (RESERVED.has(key)) continue;
      const m = raw.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|in|is)\.(.*)$/s);
      if (!m) throw httpError(400, "PGRST100", `Filtro nao suportado: ${key}=${raw}`);
      const [, not, op, value] = m;
      const col = `${alias}.${ident(key)}`;
      let sql;
      if (op === "is") {
        const v = value.toLowerCase();
        if (!["null", "true", "false"].includes(v)) throw httpError(400, "PGRST100", raw);
        sql = `${col} IS ${v.toUpperCase()}`;
      } else if (op === "in") {
        const list = splitTop(value.replace(/^\(|\)$/g, "")).map((v) => v.replace(/^"|"$/g, ""));
        args.push(list);
        sql = `${col} = ANY($${args.length})`;
      } else {
        const sqlOp = {
          eq: "=",
          neq: "<>",
          gt: ">",
          gte: ">=",
          lt: "<",
          lte: "<=",
          like: "LIKE",
          ilike: "ILIKE",
        }[op];
        args.push(op === "like" || op === "ilike" ? value.replace(/\*/g, "%") : value);
        sql = `${col} ${sqlOp} $${args.length}`;
      }
      conds.push(not ? `NOT (${sql})` : sql);
    }
    return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  }

  function orderClause(order, alias = "_t") {
    if (!order) return "";
    return (
      "ORDER BY " +
      order
        .split(",")
        .map((part) => {
          const [col, ...mods] = part.split(".");
          const dir = mods.includes("desc") ? "DESC" : "ASC";
          const nulls = mods.includes("nullsfirst")
            ? " NULLS FIRST"
            : mods.includes("nullslast")
              ? " NULLS LAST"
              : "";
          return `${alias}.${ident(col)} ${dir}${nulls}`;
        })
        .join(", ")
    );
  }

  async function withClaims(claims, fn) {
    return serial(() =>
      db.transaction(async (tx) => {
        if (claims) {
          await tx.query("SET LOCAL ROLE authenticated");
          await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [claims.sub]);
          await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
            JSON.stringify(claims),
          ]);
        } else await tx.query("SET LOCAL ROLE anon");
        return fn({ query: (sql, args) => tx.query(sql, args, { parsers: PARSERS }) });
      }),
    );
  }

  async function rest(req, url, claims, body) {
    const table = url.pathname.replace("/rest/v1/", "");
    const params = [...url.searchParams.entries()];
    const get = (k) => url.searchParams.get(k);
    const prefer = req.headers.prefer ?? "";
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (table.startsWith("rpc/")) return rpc(table.slice(4), claims, body ?? {});
    if (!IDENT.test(table)) throw httpError(404, "PGRST205", `Tabela ${table}`);
    const target = `public.${ident(table)}`;
    const args = [];
    const ret = prefer.includes("return=representation");
    const cols = await selectList(table, get("select") ?? "*");
    let sql;
    if (req.method === "GET" || req.method === "HEAD") {
      const where = whereClause(params, args);
      let tail = orderClause(get("order"));
      if (get("limit")) tail += ` LIMIT ${Number(get("limit"))}`;
      if (get("offset")) tail += ` OFFSET ${Number(get("offset"))}`;
      sql = `SELECT ${cols} FROM ${target} _t ${where} ${tail}`;
      return withClaims(claims, async (tx) => {
        const rows = (await tx.query(sql, args)).rows;
        let count = null;
        if (prefer.includes("count=exact"))
          count = Number(
            (await tx.query(`SELECT count(*)::int AS n FROM ${target} _t ${where}`, args)).rows[0]
              .n,
          );
        return { rows, count, offset: Number(get("offset") ?? 0), wantsObject };
      });
    }
    if (req.method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const values = rows
        .map(
          (r) =>
            `(${keys.map((k) => (k in r ? (args.push(r[k]), `$${args.length}`) : "DEFAULT")).join(", ")})`,
        )
        .join(", ");
      let conflict = "";
      if (prefer.includes("resolution=")) {
        const on = (get("on_conflict") ?? "id").split(",").map(ident).join(", ");
        const updates = keys.filter((k) => !(get("on_conflict") ?? "id").split(",").includes(k));
        conflict = prefer.includes("ignore-duplicates")
          ? `ON CONFLICT (${on}) DO NOTHING`
          : `ON CONFLICT (${on}) DO UPDATE SET ${updates.map((k) => `${ident(k)}=EXCLUDED.${ident(k)}`).join(", ") || `${on.split(", ")[0]}=EXCLUDED.${on.split(", ")[0]}`}`;
      }
      sql = `WITH _t AS (INSERT INTO ${target} (${keys.map(ident).join(", ")}) VALUES ${values} ${conflict} RETURNING *) SELECT ${cols} FROM _t`;
    } else if (req.method === "PATCH") {
      const keys = Object.keys(body ?? {});
      const sets = keys.map((k) => (args.push(body[k]), `${ident(k)}=$${args.length}`));
      const where = whereClause(params, args, target);
      sql = `WITH _t AS (UPDATE ${target} SET ${sets.join(", ")} ${where} RETURNING *) SELECT ${cols} FROM _t`;
    } else if (req.method === "DELETE") {
      const where = whereClause(params, args, target);
      sql = `WITH _t AS (DELETE FROM ${target} ${where} RETURNING *) SELECT ${cols} FROM _t`;
    } else throw httpError(405, "PGRST000", req.method);
    return withClaims(claims, async (tx) => {
      const rows = (await tx.query(sql, args)).rows;
      return {
        rows: ret ? rows : null,
        count: null,
        offset: 0,
        wantsObject,
        created: req.method === "POST",
      };
    });
  }

  const fnCache = new Map();
  async function rpc(name, claims, body) {
    if (!IDENT.test(name)) throw httpError(404, "PGRST202", name);
    if (!fnCache.has(name))
      fnCache.set(
        name,
        (
          await db.query(
            `SELECT p.proretset AS setof, pg_get_function_result(p.oid) AS result,
               coalesce(p.proargnames,'{}') AS names, coalesce(p.proargmodes::text[],'{}') AS modes,
               array(SELECT format_type(t,NULL) FROM unnest(p.proallargtypes) t) AS alltypes,
               array(SELECT format_type(t,NULL) FROM unnest(p.proargtypes) t) AS intypes
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname=$1`,
            [name],
          )
        ).rows,
      );
    const keys = Object.keys(body).filter((k) => body[k] !== undefined);
    const candidates = fnCache.get(name).map((f) => {
      const inNames = f.names.filter((_, i) => !f.modes.length || ["i", "b"].includes(f.modes[i]));
      return { ...f, inNames };
    });
    const fn = candidates.find((f) => keys.every((k) => f.inNames.includes(k)));
    if (!fn) throw httpError(404, "PGRST202", `Funcao ${name}(${keys}) nao encontrada`);
    const args = [];
    const call = keys
      .map((k) => {
        const type = fn.intypes[fn.inNames.indexOf(k)];
        args.push(body[k]);
        return `${ident(k)} => $${args.length}::${type}`;
      })
      .join(", ");
    const tableLike = fn.setof || /^TABLE\(/.test(fn.result);
    const sql = tableLike
      ? `SELECT * FROM public.${ident(name)}(${call})`
      : `SELECT public.${ident(name)}(${call}) AS r`;
    return withClaims(claims, async (tx) => {
      const rows = (await tx.query(sql, args)).rows;
      return { rpc: true, value: tableLike ? rows : (rows[0]?.r ?? null) };
    });
  }

  async function storage(req, url, claims, raw) {
    const path = decodeURIComponent(url.pathname.replace("/storage/v1/", ""));
    const owns = (p) => claims && p.split("/")[1] === claims.sub;
    let m;
    if (req.method === "POST" && (m = path.match(/^object\/sign\/([^/]+)\/(.+)$/))) {
      const key = `${m[1]}/${m[2]}`;
      if (!files.has(key) || !owns(key)) throw httpError(404, "404", "Object not found");
      return { json: { signedURL: `/object/public-sign/${key}?token=e2e` } };
    }
    if (
      req.method === "GET" &&
      (m = path.match(/^object\/(?:public-sign\/|authenticated\/)?([^/]+)\/(.+)$/))
    ) {
      const key = `${m[1]}/${m[2]}`;
      const f = files.get(key);
      if (!f) throw httpError(404, "404", "Object not found");
      return { bytes: f.bytes, type: f.type };
    }
    if (req.method === "POST" && (m = path.match(/^object\/([^/]+)\/(.+)$/))) {
      const key = `${m[1]}/${m[2]}`;
      if (!owns(key)) throw httpError(403, "403", "new row violates row-level security policy");
      if (files.has(key)) throw httpError(400, "409", "The resource already exists");
      let bytes = raw;
      let type = req.headers["content-type"] ?? "application/octet-stream";
      if (type.startsWith("multipart/form-data")) {
        const form = await new Response(raw, { headers: { "content-type": type } }).formData();
        const file = [...form.values()].find((v) => typeof v === "object");
        bytes = Buffer.from(await file.arrayBuffer());
        type = file.type || "application/octet-stream";
      }
      files.set(key, { bytes, type, owner: claims.sub });
      return { json: { Key: key, Id: key } };
    }
    if (req.method === "DELETE" && (m = path.match(/^object\/([^/]+)$/))) {
      const prefixes = JSON.parse(raw.toString() || "{}").prefixes ?? [];
      const removed = prefixes
        .map((p) => `${m[1]}/${p}`)
        .filter((key) => owns(key) && files.delete(key));
      return { json: removed.map((name) => ({ name })) };
    }
    throw httpError(404, "404", `Storage nao suportado: ${req.method} ${path}`);
  }

  function authUser(u) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  async function auth(req, url, claims, body) {
    const path = url.pathname.replace("/auth/v1/", "");
    if (path === "token") {
      const grant = url.searchParams.get("grant_type");
      const u =
        grant === "password"
          ? users.get(body?.email?.toLowerCase())
          : [...users.values()].find((x) => body?.refresh_token === `refresh-${x.id}`);
      if (!u || (grant === "password" && u.password !== body.password))
        return {
          status: 400,
          json: { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" },
        };
      return {
        json: {
          access_token: makeJwt(u),
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: `refresh-${u.id}`,
          user: authUser(u),
        },
      };
    }
    if (path === "user") {
      const u = claims && [...users.values()].find((x) => x.id === claims.sub);
      if (!u) return { status: 401, json: { code: 401, msg: "invalid JWT" } };
      return { json: authUser(u) };
    }
    if (path === "logout") return { status: 204 };
    return { status: 404, json: { msg: `auth ${path} nao suportado` } };
  }

  const server = createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,PUT,HEAD,OPTIONS",
      "access-control-expose-headers": "content-range, content-profile",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const claims = decodeJwt(token);
    const json = (status, value, extra = {}) => {
      res.writeHead(status, { ...cors, "content-type": "application/json", ...extra });
      res.end(value === undefined ? "" : JSON.stringify(value));
    };
    try {
      const isJson = (req.headers["content-type"] ?? "").includes("json");
      const body = isJson && raw.length ? JSON.parse(raw.toString()) : undefined;
      if (url.pathname.startsWith("/auth/v1/")) {
        const r = await auth(req, url, claims, body);
        return json(r.status ?? 200, r.json);
      }
      if (url.pathname.startsWith("/storage/v1/")) {
        const r = await storage(req, url, claims, raw);
        if (r.bytes) {
          res.writeHead(200, { ...cors, "content-type": r.type });
          return res.end(r.bytes);
        }
        return json(200, r.json);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const r = await rest(req, url, claims, body);
        if (r.rpc) return json(200, r.value);
        if (r.rows === null) return json(r.created ? 201 : 204, undefined);
        const headers = {};
        if (r.count !== null)
          headers["content-range"] = r.rows.length
            ? `${r.offset}-${r.offset + r.rows.length - 1}/${r.count}`
            : `*/${r.count}`;
        if (r.wantsObject) {
          if (r.rows.length !== 1)
            return json(406, {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
              details: `The result contains ${r.rows.length} rows`,
              hint: null,
            });
          return json(200, r.rows[0], headers);
        }
        return json(r.created ? 201 : 200, r.rows, headers);
      }
      return json(404, { message: "not found" });
    } catch (error) {
      const status =
        error.status ??
        (error.code === "42501" ? (claims ? 403 : 401) : error.code === "23505" ? 409 : 400);
      requests.push({
        method: req.method,
        path: url.pathname + url.search,
        status,
        code: error.code,
        message: error.message,
      });
      return json(status, {
        code: error.code ?? null,
        message: error.message,
        details: error.detail ?? null,
        hint: error.hint ?? null,
      });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  const api = {
    db,
    files,
    users,
    errors: requests,
    url: `http://127.0.0.1:${port}`,
    addUser(user) {
      users.set(user.email.toLowerCase(), user);
    },
    asUser: (id, fn) => withClaims({ sub: id, role: "authenticated" }, fn),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
  if (seed) await seed(api);
  return api;
}
