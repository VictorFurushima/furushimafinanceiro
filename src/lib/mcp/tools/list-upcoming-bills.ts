import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_upcoming_bills",
  title: "Listar faturas próximas",
  description: "Lista faturas de cartão de crédito, abertas ou atrasadas, ordenadas por vencimento.",
  inputSchema: {
    include_paid: z.boolean().optional().describe("Se true, inclui faturas já pagas. Padrão: false."),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ include_paid, limit }, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    let q = supabaseForUser(ctx)
      .from("credit_card_bills")
      .select("id, card_id, month, year, amount, due_date, payment_date, status")
      .order("due_date", { ascending: true })
      .limit(limit ?? 50);
    if (!include_paid) q = q.in("status", ["aberta", "atrasada"]);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
