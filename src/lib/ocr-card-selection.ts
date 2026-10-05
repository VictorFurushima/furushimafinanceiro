export type CardSelectionSource = "ocr_match" | "single_card" | "primary_card" | "manual";
export interface SelectableCard {
  id: string;
  name: string;
  status: string;
  last_four?: string | null;
}
export function cardLastFour(text: string): string[] {
  const values = [
    ...text.matchAll(
      /(?:final(?:\s+do\s+cart[aã]o)?|terminad[oa](?:\s+em)?|[•*xX]{2,})[\s:.-]*(\d{4})(?!\d)/gi,
    ),
  ].map((m) => m[1]);
  return [...new Set(values)];
}
export function selectOcrCard(
  cards: SelectableCard[],
  evidence: string,
  primaryId?: string | null,
): { card_id: string; card_selection_source: CardSelectionSource | null } {
  const active = cards.filter((c) => c.status === "active");
  const detected = cardLastFour(evidence);
  const matches = active.filter((c) =>
    detected.includes(c.last_four || cardLastFour(c.name)[0] || ""),
  );
  if (detected.length) {
    if (detected.length === 1 && matches.length === 1)
      return { card_id: matches[0].id, card_selection_source: "ocr_match" };
    if (
      detected.length === 1 &&
      active.length === 1 &&
      !active[0].last_four &&
      !cardLastFour(active[0].name).length
    )
      return { card_id: active[0].id, card_selection_source: "single_card" };
    // Unmatched or ambiguous explicit evidence needs manual review.
    return { card_id: "", card_selection_source: null };
  }
  if (active.length === 1) return { card_id: active[0].id, card_selection_source: "single_card" };
  const primary = active.find((c) => c.id === primaryId);
  return primary
    ? { card_id: primary.id, card_selection_source: "primary_card" }
    : { card_id: "", card_selection_source: null };
}
