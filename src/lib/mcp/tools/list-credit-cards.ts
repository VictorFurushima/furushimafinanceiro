import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_credit_cards",
  title: "Listar cartões de crédito",
  description: "Lista cartões de crédito do usuário com limite total, limite usado e limite disponível.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    const { data, error } = await supabaseForUser(ctx)
      .from("credit_cards")
      .select("id, name, bank, total_limit, used_limit, closing_day, due_day, status, color, created_at")
      .order("created_at");
    if (error) return errorResult(error.message);
    const enriched = (data ?? []).map((c) => ({
      ...c,
      available_limit: Number(c.total_limit ?? 0) - Number(c.used_limit ?? 0),
    }));
    return jsonResult(enriched);
  },
});
