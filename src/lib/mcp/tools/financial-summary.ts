import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";
import { todayISO } from "@/lib/date-only";

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
    // Mês padrão no fuso do app (America/Sao_Paulo), não no relógio UTC do servidor.
    const [currentYear, currentMonth] = todayISO().split("-").map(Number);
    const y = year ?? currentYear;
    const m = month ?? currentMonth;
    const mm = String(m).padStart(2, "0");
    const start = `${y}-${mm}-01`;
    const end = `${y}-${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

    const supa = supabaseForUser(ctx);
    const [sumRes, accRes] = await Promise.all([
      supa.rpc("get_monthly_financial_summary", { p_from: start, p_to: end }),
      supa.rpc("get_account_balances"),
    ]);
    if (sumRes.error) return errorResult(sumRes.error.message);
    if (accRes.error) return errorResult(accRes.error.message);

    const row = (sumRes.data ?? [])[0];
    const income = Number(row?.receitas ?? 0);
    const expense = Number(row?.despesas ?? 0);
    const totalBalance = (accRes.data ?? []).reduce(
      (s: number, a: { balance: number | string | null }) => s + Number(a.balance ?? 0),
      0,
    );

    return jsonResult({
      period: { year: y, month: m, start, end },
      income,
      expense,
      net: Number(row?.saldo_liquido ?? income - expense),
      aportes: Number(row?.aportes ?? 0),
      resgates: Number(row?.resgates ?? 0),
      total_account_balance: totalBalance,
    });
  },
});
