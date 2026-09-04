import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";
import { isValidDateOnly, todayISO } from "@/lib/date-only";

export default defineTool({
  name: "create_transaction",
  title: "Registrar transação",
  description:
    "Cria uma nova transação (receita ou despesa) para o usuário autenticado. O valor deve ser positivo; o tipo (income/expense) determina o sinal contábil.",
  inputSchema: {
    type: z.enum(["income", "expense", "transfer"]).describe("Tipo: income, expense ou transfer."),
    amount: z.number().positive().describe("Valor em BRL, positivo."),
    description: z.string().min(1).max(200).describe("Descrição curta."),
    occurred_at: z.string().optional().describe("Data YYYY-MM-DD. Padrão: hoje."),
    account_id: z.string().uuid().optional().describe("ID da conta (opcional)."),
    destination_account_id: z
      .string()
      .uuid()
      .optional()
      .describe("Conta de destino, obrigatória em transferências."),
    credit_card_id: z
      .string()
      .uuid()
      .optional()
      .describe("Cartão, obrigatório para despesas no crédito."),
    installment_count: z.number().int().min(1).max(120).optional().describe("Número de parcelas."),
    category_id: z.string().uuid().optional().describe("ID da categoria (opcional)."),
    payment_method: z
      .enum(["pix", "dinheiro", "debito", "credito", "boleto", "transferencia"])
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
    const occurredAt = input.occurred_at ?? todayISO();
    if (!isValidDateOnly(occurredAt)) return errorResult("Data inválida; use YYYY-MM-DD.");
    const isTransfer = input.type === "transfer";
    const isCredit = input.payment_method === "credito";
    if (isTransfer) {
      if (
        !input.account_id ||
        !input.destination_account_id ||
        input.account_id === input.destination_account_id
      ) {
        return errorResult("Transferência exige contas de origem e destino diferentes.");
      }
      if (input.credit_card_id || (input.installment_count ?? 1) !== 1) {
        return errorResult("Transferência não aceita cartão ou parcelas.");
      }
    } else if (input.destination_account_id) {
      return errorResult("Conta de destino só pode ser usada em transferência.");
    }
    if (isCredit && (input.type !== "expense" || !input.credit_card_id)) {
      return errorResult("Despesa no crédito exige credit_card_id.");
    }
    if (!isCredit && (input.credit_card_id || (input.installment_count ?? 1) !== 1)) {
      return errorResult("Cartão e parcelas exigem payment_method igual a credito.");
    }

    const { data, error } = await supabaseForUser(ctx)
      .from("transactions")
      .insert({
        user_id: ctx.getUserId()!,
        type: input.type,
        amount: input.amount,
        description: input.description,
        occurred_at: occurredAt,
        account_id: isCredit ? null : (input.account_id ?? null),
        destination_account_id: isTransfer ? input.destination_account_id! : null,
        credit_card_id: isCredit ? input.credit_card_id! : null,
        installment_count: isCredit ? (input.installment_count ?? 1) : 1,
        category_id: input.category_id ?? null,
        payment_method: isTransfer ? "transferencia" : (input.payment_method ?? null),
        notes: input.notes ?? null,
      })
      .select(
        "id, type, amount, description, occurred_at, account_id, destination_account_id, credit_card_id, bill_id, category_id, payment_method, installment_count, flow, created_at",
      )
      .single();
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
