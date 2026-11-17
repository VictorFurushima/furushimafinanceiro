import { z } from "zod";
import { isValidDateOnly } from "./date-only";
import { cardLastFour } from "./ocr-card-selection";
import { resolveOcrDateLabel } from "./ocr-date";

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
        date_text: nullableText(80).optional(),
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

export interface OcrNormalizeOptions {
  /** Dia em que o print foi tirado: resolve "Hoje", dias da semana e datas sem ano. */
  referenceDate?: string;
  /** Finais dos cartões de crédito ativos do titular: "final 5461" vira pagamento no crédito. */
  creditCardFinals?: string[];
}

const DATE_ISSUE = /\bdata\b|\bano\b|dia do m[eê]s|dia da semana|hor[aá]rio/i;
const PAYMENT_ISSUE = /pagamento|cr[eé]dito|d[eé]bito/i;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function normalizeOcrResponse(input: unknown, options: OcrNormalizeOptions = {}) {
  const parsed = OcrResponseSchema.parse(input);
  const finals = new Set(options.creditCardFinals ?? []);
  const dropped = { illegible: 0, declined: 0, undated: 0 };
  const transactions = parsed.transactions.flatMap((row) => {
    const amount =
      row.amount !== null &&
      row.amount > 0 &&
      Math.abs(row.amount * 100 - Math.round(row.amount * 100)) < 0.00001
        ? row.amount
        : null;
    // Compra negada ou cancelada não é movimentação; corte sem valor ou descrição não tem o que revisar.
    if (row.transaction_status === "cancelled") {
      dropped.declined++;
      return [];
    }
    if (amount === null || !row.description?.trim()) {
      dropped.illegible++;
      return [];
    }
    // Sem nenhuma data no print (ex.: mensagem acima do primeiro cabeçalho): outro print a mostra.
    if (!row.date && !row.date_text) {
      dropped.undated++;
      return [];
    }
    const resolved = options.referenceDate
      ? resolveOcrDateLabel(row.date_text, options.referenceDate)
      : null;
    const date = resolved ?? (isValidDateOnly(row.date) ? row.date : null);
    const evidence = `${row.account ?? ""}\n${row.raw_text}`;
    const payment_method =
      row.payment_method ??
      (row.type !== "income" && cardLastFour(evidence).some((n) => finals.has(n))
        ? ("credito" as const)
        : null);
    const issues = row.issues.filter(
      (issue) =>
        !(date && DATE_ISSUE.test(issue)) && !(payment_method && PAYMENT_ISSUE.test(issue)),
    );
    if (!date) issues.push("Data: informe uma data completa e válida.");
    if (!row.type) issues.push("Tipo: confirme se o valor entrou ou saiu.");
    if (!payment_method) issues.push("Pagamento: confirme a forma de pagamento.");
    if (!row.raw_text.trim()) issues.push("Evidência: confira este item na imagem original.");
    if (row.transaction_status !== "completed")
      issues.push("Situação: confirme se a movimentação foi efetivada.");
    if (["refund", "bill_payment", "unknown"].includes(row.movement_kind))
      issues.push("Natureza: confira como esta movimentação deve ser registrada.");
    return [
      {
        ...row,
        date,
        amount,
        payment_method,
        issues: [...new Set(issues)],
        confidence: issues.length ? ("baixa" as const) : row.confidence,
        external_reference: row.external_reference?.trim() || null,
      },
    ];
  });
  let status = parsed.analysis_status;
  const warnings = [...parsed.warnings];
  if (dropped.illegible)
    warnings.push(
      `${plural(dropped.illegible, "movimentação cortada ou ilegível foi ignorada", "movimentações cortadas ou ilegíveis foram ignoradas")}.`,
    );
  if (dropped.declined)
    warnings.push(
      `${plural(dropped.declined, "compra negada ou cancelada foi ignorada", "compras negadas ou canceladas foram ignoradas")}.`,
    );
  if (dropped.undated)
    warnings.push(
      `${plural(dropped.undated, "mensagem sem data visível foi ignorada", "mensagens sem data visível foram ignoradas")}. Inclua o cabeçalho de data no print.`,
    );
  const ignored = dropped.illegible + dropped.declined + dropped.undated;
  if (
    parsed.visible_transaction_count !== null &&
    parsed.visible_transaction_count !== transactions.length + ignored
  ) {
    warnings.push(
      `Contagem divergente: ${parsed.visible_transaction_count} movimentos visíveis e ${transactions.length} itens retornados. Confira o print.`,
    );
    status = "partial";
  }
  if (
    status === "complete" &&
    ((!transactions.length && !ignored) || transactions.some((t) => t.issues.length))
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
