import { z } from "zod";
import { isValidDateOnly } from "./date-only";

const nullableText = (max: number) => z.string().max(max).nullable();
const confidence = z.enum(["alta", "media", "baixa"]);
export const OcrResponseSchema = z.object({
  document_type: z.enum(["statement", "card_statement", "receipt", "wallet", "unknown"]),
  analysis_status: z.enum(["complete", "partial", "unreadable", "not_financial"]),
  visible_transaction_count: z.number().int().min(0).max(10000).nullable(),
  warnings: z.array(z.string().max(400)).max(30),
  overall_confidence: confidence,
  transactions: z
    .array(
      z.object({
        date: nullableText(40),
        amount: z.number().finite().nullable(),
        type: z.enum(["income", "expense", "transfer"]).nullable(),
        description: nullableText(300),
        payment_method: z
          .enum(["pix", "debito", "credito", "dinheiro", "boleto", "transferencia"])
          .nullable(),
        account: nullableText(120),
        suggested_category: nullableText(120),
        confidence,
        raw_text: z.string().max(800),
        issues: z.array(z.string().max(300)).max(20),
        external_reference: nullableText(160),
        movement_kind: z.enum([
          "payment",
          "income",
          "own_transfer",
          "refund",
          "bill_payment",
          "unknown",
        ]),
        transaction_status: z.enum(["completed", "pending", "cancelled", "unknown"]),
      }),
    )
    .max(500),
});

export function normalizeOcrResponse(input: unknown) {
  const parsed = OcrResponseSchema.parse(input);
  const transactions = parsed.transactions.map((row) => {
    const issues = [...row.issues];
    const date = isValidDateOnly(row.date) ? row.date : null;
    const amount =
      row.amount !== null &&
      row.amount > 0 &&
      Math.abs(row.amount * 100 - Math.round(row.amount * 100)) < 0.00001
        ? row.amount
        : null;
    if (!date) issues.push("Data: informe uma data completa e válida.");
    if (amount === null) issues.push("Valor: informe o valor legível em reais e centavos.");
    if (!row.type) issues.push("Tipo: confirme se o valor entrou ou saiu.");
    if (!row.description?.trim()) issues.push("Descrição: identifique a movimentação.");
    if (!row.payment_method) issues.push("Pagamento: confirme a forma de pagamento.");
    if (!row.raw_text.trim()) issues.push("Evidência: confira este item na imagem original.");
    if (row.transaction_status !== "completed")
      issues.push("Situação: confirme se a movimentação foi efetivada.");
    if (["refund", "bill_payment", "unknown"].includes(row.movement_kind))
      issues.push("Natureza: confira como esta movimentação deve ser registrada.");
    return {
      ...row,
      date,
      amount,
      issues: [...new Set(issues)],
      confidence: issues.length ? ("baixa" as const) : row.confidence,
      external_reference: row.external_reference?.trim() || null,
    };
  });
  let status = parsed.analysis_status;
  const warnings = [...parsed.warnings];
  if (
    parsed.visible_transaction_count !== null &&
    parsed.visible_transaction_count !== transactions.length
  ) {
    warnings.push(
      `Contagem divergente: ${parsed.visible_transaction_count} movimentos visíveis e ${transactions.length} itens retornados. Confira o print.`,
    );
    status = "partial";
  }
  if (
    status === "complete" &&
    (!transactions.length || transactions.some((t) => t.issues.length))
  ) {
    status = "partial";
    if (!transactions.length)
      warnings.push("A leitura retornou uma lista vazia sem confirmar ausência de movimentações.");
  }
  if (transactions.length && ["unreadable", "not_financial"].includes(status)) status = "partial";
  return { ...parsed, transactions, analysis_status: status, warnings: [...new Set(warnings)] };
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const normalizeOcrText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
