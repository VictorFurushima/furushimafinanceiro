import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "financial_summary",
  title: "Resumo financeiro do mês",
  description:
    "Calcula totais de receitas, despesas e saldo do mês informado (padrão: mês atual). Também retorna soma de saldos de todas as contas.",
  inputSchema: {
    year: z.number().int().min(2000).max(2100).optional(),
    month: z.number().int().min(1).max(12).optional().describe("Mês 1-12."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ year, month }, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    const now = new Date();
    const y = year ?? now.getUTCFullYear();
    const m = month ?? now.getUTCMonth() + 1;
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const endDate = new Date(Date.UTC(y, m, 0));
    const end = endDate.toISOString().slice(0, 10);

    const supa = supabaseForUser(ctx);
    const [txRes, accRes] = await Promise.all([
      supa.from("transactions").select("type, amount").gte("occurred_at", start).lte("occurred_at", end),
      supa.from("accounts").select("initial_balance"),
    ]);
    if (txRes.error) return errorResult(txRes.error.message);
    if (accRes.error) return errorResult(accRes.error.message);

    let income = 0, expense = 0;
    for (const t of txRes.data ?? []) {
      const v = Number(t.amount ?? 0);
      if (t.type === "income") income += v;
      else if (t.type === "expense") expense += v;
    }
    const totalBalance = (accRes.data ?? []).reduce((s, a) => s + Number(a.initial_balance ?? 0), 0);

    return jsonResult({
      period: { year: y, month: m, start, end },
      income,
      expense,
      net: income - expense,
      total_account_balance: totalBalance,
      transaction_count: txRes.data?.length ?? 0,
    });
  },
});
