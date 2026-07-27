import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_recharges",
  title: "Listar recargas de saldo",
  description:
    "Lista recargas previstas de saldo (salário, freelance, reembolso, fatura, liberação de limite, etc.). Filtros opcionais por status e intervalo.",
  inputSchema: {
    status: z.enum(["prevista", "confirmada", "recebida", "atrasada", "cancelada"]).optional(),
    from_date: z.string().optional().describe("Data inicial YYYY-MM-DD."),
    to_date: z.string().optional().describe("Data final YYYY-MM-DD."),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, from_date, to_date, limit }, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    let q = supabaseForUser(ctx)
      .from("balance_recharges")
      .select("*")
      .order("expected_date", { ascending: true })
      .limit(limit ?? 100);
    if (status) q = q.eq("status", status);
    if (from_date) q = q.gte("expected_date", from_date);
    if (to_date) q = q.lte("expected_date", to_date);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
