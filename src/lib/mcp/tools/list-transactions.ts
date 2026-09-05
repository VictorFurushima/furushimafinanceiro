import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_transactions",
  title: "Listar transações",
  description:
    "Lista transações do usuário com paginação real no servidor. Pode filtrar por tipo (income/expense/transfer), intervalo de datas (YYYY-MM-DD), limite por página e página/offset. Retorna as mais recentes primeiro.",
  inputSchema: {
    type: z
      .enum(["income", "expense", "transfer"])
      .optional()
      .describe("Filtra por tipo de transação."),
    from_date: z.string().optional().describe("Data inicial YYYY-MM-DD (inclusive)."),
    to_date: z.string().optional().describe("Data final YYYY-MM-DD (inclusive)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Registros por página (padrão 50, máximo 200)."),
    page: z.number().int().min(1).optional().describe("Página começando em 1 (padrão 1)."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Deslocamento absoluto; tem prioridade sobre page."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ type, from_date, to_date, limit, page, offset }, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;

    const pageSize = Math.min(Math.max(limit ?? 50, 1), 200);
    const start = offset ?? ((page ?? 1) - 1) * pageSize;
    const end = start + pageSize - 1;

    let q = supabaseForUser(ctx)
      .from("transactions")
      .select(
        "id, type, amount, description, occurred_at, payment_method, category_id, account_id, credit_card_id, destination_account_id, bill_id, installment_count, flow, subcategory, notes",
        { count: "exact" },
      )
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, end);

    if (type) q = q.eq("type", type);
    if (from_date) q = q.gte("occurred_at", from_date);
    if (to_date) q = q.lte("occurred_at", to_date);

    const { data, error, count } = await q;
    if (error) return errorResult(error.message);

    const rows = data ?? [];
    return jsonResult({
      transactions: rows,
      pagination: {
        page: offset !== undefined ? Math.floor(start / pageSize) + 1 : (page ?? 1),
        page_size: pageSize,
        offset: start,
        returned: rows.length,
        total: count ?? null,
        has_more:
          count !== null && count !== undefined ? end + 1 < count : rows.length === pageSize,
      },
    });
  },
});
