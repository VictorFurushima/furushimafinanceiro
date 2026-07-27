import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_transactions",
  title: "Listar transações",
  description:
    "Lista transações recentes do usuário. Pode filtrar por tipo (income/expense), intervalo de datas (YYYY-MM-DD) e limite. Retorna as mais recentes primeiro.",
  inputSchema: {
    type: z.enum(["income", "expense"]).optional().describe("Filtra por tipo de transação."),
    from_date: z.string().optional().describe("Data inicial YYYY-MM-DD (inclusive)."),
    to_date: z.string().optional().describe("Data final YYYY-MM-DD (inclusive)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de registros (padrão 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ type, from_date, to_date, limit }, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    let q = supabaseForUser(ctx)
      .from("transactions")
      .select("id, type, amount, description, occurred_at, payment_method, category_id, account_id, subcategory, notes")
      .order("occurred_at", { ascending: false })
      .limit(limit ?? 50);
    if (type) q = q.eq("type", type);
    if (from_date) q = q.gte("occurred_at", from_date);
    if (to_date) q = q.lte("occurred_at", to_date);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
