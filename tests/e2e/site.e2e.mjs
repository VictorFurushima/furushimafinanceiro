// Teste ponta a ponta do site: app real (vite dev) + navegador (Playwright) + Supabase emulado sobre
// PGlite com as migrations do projeto. Uso:
//   npm i --no-save playwright-core@1.56.1   (ou PLAYWRIGHT_MODULE apontando para um playwright instalado)
//   node tests/e2e/site.e2e.mjs
// Variaveis: CHROMIUM_PATH (padrao /opt/pw-browsers/chromium-1194/chrome-linux/chrome),
// E2E_SHOTS (pasta de screenshots), E2E_ONLY (filtra cenarios pelo nome).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmulator } from "./supabase-emulator.mjs";
import { seed, OWNER, VIEWER, GUEST, PNG } from "./seed.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright-core").catch(() => {
  console.error(
    "Playwright ausente: rode `npm i --no-save playwright-core@1.56.1` ou defina PLAYWRIGHT_MODULE.",
  );
  process.exit(2);
});
const ROOT = new URL("../../", import.meta.url).pathname;
const SHOTS = process.env.E2E_SHOTS ?? join(tmpdir(), "furushima-e2e");
const API_PORT = 54321;
const APP_PORT = 8089;
const APP = `http://127.0.0.1:${APP_PORT}`;
mkdirSync(SHOTS, { recursive: true });

const api = await startEmulator({ port: API_PORT, seed });
const env = {
  ...process.env,
  VITE_SUPABASE_URL: api.url,
  VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-anon",
  VITE_SUPABASE_PROJECT_ID: "e2e",
  SUPABASE_URL: api.url,
  SUPABASE_PUBLISHABLE_KEY: "e2e-anon",
};
const vite = spawn(
  join(ROOT, "node_modules/.bin/vite"),
  ["dev", "--port", String(APP_PORT), "--host", "127.0.0.1", "--strictPort"],
  { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
);
let viteLog = "";
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`vite nao subiu:\n${viteLog}`)), 90_000);
  const onData = (d) => {
    viteLog += d;
    if (viteLog.includes("Local:")) {
      clearTimeout(timer);
      resolve();
    }
  };
  vite.stdout.on("data", onData);
  vite.stderr.on("data", onData);
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const results = [];
const problems = [];
let current = "setup";

function watch(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Download the React DevTools|favicon/.test(msg.text()))
      problems.push({ scenario: current, kind: "console", text: msg.text().slice(0, 400) });
  });
  page.on("pageerror", (err) =>
    problems.push({ scenario: current, kind: "pageerror", text: String(err).slice(0, 400) }),
  );
  page.on("response", (res) => {
    if (res.url().startsWith(api.url) && res.status() >= 400)
      problems.push({
        scenario: current,
        kind: `api ${res.status()}`,
        text: `${res.request().method()} ${res.url().replace(api.url, "")}`.slice(0, 300),
      });
  });
  page.on("dialog", (d) => d.accept());
}

async function scenario(name, fn) {
  if (process.env.E2E_ONLY && !name.includes(process.env.E2E_ONLY) && !name.startsWith("login"))
    return;
  current = name;
  const before = problems.length;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started, issues: problems.length - before });
    console.log(
      `PASS ${name}${problems.length > before ? ` (${problems.length - before} avisos)` : ""}`,
    );
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error).slice(0, 600) });
    console.log(`FAIL ${name}\n     ${String(error).split("\n").slice(0, 4).join("\n     ")}`);
    await page
      .screenshot({ path: join(SHOTS, `FAIL-${slug(name)}.png`), fullPage: true })
      .catch(() => {});
  }
}
const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/[^\w]+/g, "-")
    .slice(0, 60);
const shot = (name) => page.screenshot({ path: join(SHOTS, `${slug(name)}.png`), fullPage: true });
const toast = async (pattern) =>
  page
    .locator("[data-sonner-toast]")
    .filter({ hasText: pattern })
    .first()
    .waitFor({ timeout: 15_000 });

const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const page = await context.newPage();
watch(page);

// O vite dev compila sob demanda: interagir antes da hidratacao envia o formulario nativo.
async function hydrated() {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("form, main, button");
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    },
    null,
    { timeout: 60_000 },
  );
}

async function login(user) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 120_000 });
  await hydrated();
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

const ROUTES = [
  ["/dashboard", /Visão Geral|Painel|Patrimônio/i],
  ["/global-wallet", /Carteira Global/i],
  ["/accounts", /Contas/i],
  ["/transactions", /Transações/i],
  ["/income", /Receitas/i],
  ["/cards", /Cartões/i],
  ["/installments", /Parcelas/i],
  ["/recurring", /Assinaturas/i],
  ["/recharges", /Recargas/i],
  ["/budgets", /Orçamento/i],
  ["/goals", /Metas/i],
  ["/investments", /Investimentos/i],
  ["/shopping-planner", /Planejador|Compras/i],
  ["/statistics", /Estatísticas/i],
  ["/timeline", /Linha do Tempo/i],
  ["/history", /Histórico/i],
  ["/import", /Importar CSV/i],
  ["/import-prints", /Importar por Print/i],
  ["/settings", /Configurações/i],
];

try {
  await scenario("login do titular", async () => {
    await login(OWNER);
    await shot("dashboard");
  });

  for (const [route, title] of ROUTES)
    await scenario(`abre ${route}`, async () => {
      await page.goto(`${APP}${route}`, { timeout: 120_000 });
      await hydrated();
      await page
        .getByRole("heading", { level: 1 })
        .filter({ hasText: title })
        .first()
        .waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      const body = await page.locator("main").innerText();
      assert.doesNotMatch(
        body,
        /Algo deu errado|Something went wrong|Unexpected Application Error/i,
      );
      await shot(route);
    });

  if (process.env.E2E_FLOWS !== "0") {
    const flows = await import(process.env.E2E_FLOWS_FILE ?? "./flows.mjs").catch((e) =>
      e.code === "ERR_MODULE_NOT_FOUND" ? null : Promise.reject(e),
    );
    if (flows)
      await flows.run({
        page,
        api,
        scenario,
        shot,
        toast,
        APP,
        OWNER,
        VIEWER,
        GUEST,
        PNG,
        login,
        assert,
        context,
        hydrated,
      });
  }
} finally {
  await browser.close();
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {}
  vite.stdout.destroy();
  vite.stderr.destroy();
  const report = { results, problems, apiErrors: api.errors };
  writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
  await api.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${results.length - failed}/${results.length} cenarios passaram; ${problems.length} avisos de console/API. Relatorio e screenshots: ${SHOTS}`,
  );
  if (problems.length)
    for (const p of problems.slice(0, 40)) console.log(`  [${p.scenario}] ${p.kind}: ${p.text}`);
  process.exitCode = failed ? 1 : 0;
}
