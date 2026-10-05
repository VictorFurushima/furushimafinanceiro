import type { Json } from "@/integrations/supabase/types";
import { isValidDateOnly } from "./date-only";
import { selectOcrCard, type SelectableCard, type CardSelectionSource } from "./ocr-card-selection";
export interface OcrMatch {
  source: "transaction" | "review";
  id: string;
  date: string;
  amount: number;
  type: string;
  description: string | null;
  account: string;
  image_id: string | null;
}
export interface OcrItem {
  id: string;
  image_id: string;
  detected_date: string | null;
  detected_amount: number | null;
  detected_type: string | null;
  detected_description: string | null;
  detected_payment_method: string | null;
  detected_account: string | null;
  suggested_category_id: string | null;
  confidence_level: string | null;
  review_status: string;
  saved_transaction_id: string | null;
  raw_text: string | null;
  issues: string[];
  movement_kind: string;
  transaction_status: string;
  external_reference: string | null;
  review_account_id: string | null;
  review_card_id: string | null;
  card_selection_source?: CardSelectionSource | null;
  review_destination_account_id: string | null;
  matches: OcrMatch[];
}
export interface OcrReview {
  count: number;
  summary: { total: number; saved: number; pending: number; incomplete: number; ignored: number };
  rows: OcrItem[];
}
export interface OcrDraft {
  date: string;
  amount: string;
  type: string;
  description: string;
  payment_method: string;
  account_id: string;
  card_id: string;
  card_selection_source: CardSelectionSource | null;
  destination_account_id: string;
  category_id: string;
  confirmed: boolean;
  movement_kind: string;
  external_reference: string;
  reference_verified: boolean;
}
export interface OcrSaveResult {
  status: string;
  transaction_id?: string;
  matches?: OcrMatch[];
}
export function newOcrDraft(item: OcrItem, defaultAccount = ""): OcrDraft {
  return {
    date: item.detected_date ?? "",
    amount: item.detected_amount?.toString() ?? "",
    type: item.detected_type ?? "",
    description: item.detected_description ?? "",
    payment_method: item.detected_payment_method ?? "",
    account_id: item.review_account_id ?? defaultAccount,
    card_id: item.review_card_id ?? "",
    card_selection_source: item.card_selection_source ?? (item.review_card_id ? "manual" : null),
    destination_account_id: item.review_destination_account_id ?? "",
    category_id: item.suggested_category_id ?? "",
    movement_kind: item.movement_kind,
    confirmed: false,
    external_reference: item.external_reference ?? "",
    reference_verified: false,
  };
}
export function requiresOcrConfirmation(item: OcrItem) {
  return (
    item.issues.length > 0 ||
    item.transaction_status !== "completed" ||
    item.confidence_level !== "alta"
  );
}
export function ocrDraftReady(item: OcrItem, d: OcrDraft) {
  const n = Number(d.amount);
  return (
    isValidDateOnly(d.date) &&
    d.amount.trim() !== "" &&
    Number.isFinite(n) &&
    n > 0 &&
    Math.abs(n * 100 - Math.round(n * 100)) < 0.00001 &&
    ["income", "expense", "transfer"].includes(d.type) &&
    !!d.description.trim() &&
    !!d.payment_method &&
    (d.payment_method === "credito" ? d.type === "expense" && !!d.card_id : !!d.account_id) &&
    (d.type !== "transfer" ||
      (!!d.destination_account_id && d.destination_account_id !== d.account_id)) &&
    (!requiresOcrConfirmation(item) || d.confirmed)
  );
}
export function ocrFields(draft: OcrDraft): Json {
  return {
    ...draft,
    amount: draft.amount.trim() ? Number(draft.amount) : null,
    account_id: draft.payment_method === "credito" ? null : draft.account_id || null,
    card_id: draft.payment_method === "credito" ? draft.card_id || null : null,
    card_selection_source: draft.payment_method === "credito" ? draft.card_selection_source : null,
    category_id: draft.type === "transfer" ? null : draft.category_id || null,
    destination_account_id: draft.type === "transfer" ? draft.destination_account_id || null : null,
  };
}

/** Resolve at render/save time so asynchronously loaded cards and preferences are current. */
export function resolveOcrDraft(
  draft: OcrDraft,
  item: OcrItem,
  cards: SelectableCard[],
  primaryId?: string | null,
): OcrDraft {
  if (draft.payment_method !== "credito" || item.review_status === "saved") return draft;
  const chosen = cards.find((c) => c.id === draft.card_id && c.status === "active");
  if (chosen && draft.card_selection_source === "manual") return draft;
  return {
    ...draft,
    ...selectOcrCard(cards, `${item.detected_account ?? ""}\n${item.raw_text ?? ""}`, primaryId),
  };
}
