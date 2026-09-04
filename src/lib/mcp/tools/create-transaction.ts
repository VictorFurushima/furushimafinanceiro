import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";
import { todayISO } from "@/lib/date-only";

export default defineTool({
  name: "create_transaction",
  title: "Registrar transação",
  description:
    "Cria uma nova transação (receita ou despesa) para o usuário autenticado. O valor deve ser positivo; o tipo (income/expense) determina o sinal contábil.",
  inputSchema: {
    type: z.enum(["income", "expense"]).describe("Tipo: income (receita) ou expense (despesa)."),
    amount: z.number().positive().describe("Valor em BRL, positivo."),
    description: z.string().min(1).max(200).describe("Descrição curta."),
    occurred_at: z.string().optional().describe("Data YYYY-MM-DD. Padrão: hoje."),
    account_id: z.string().uuid().optional().describe("ID da conta (opcional)."),
    category_id: z.string().uuid().optional().describe("ID da categoria (opcional)."),
    payment_method: z
      .string()
      .optional()
      .describe("pix, dinheiro, debito, credito, boleto, transferencia."),
    notes: z.string().max(500).optional().describe("Observações adicionais."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    const { data, error } = await supabaseForUser(ctx)
      .from("transactions")
      .insert({
        user_id: ctx.getUserId()!,
        type: input.type,
        amount: input.amount,
        description: input.description,
        occurred_at: input.occurred_at ?? todayISO(),
        account_id: input.account_id ?? null,
        category_id: input.category_id ?? null,
        payment_method: input.payment_method ?? null,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
