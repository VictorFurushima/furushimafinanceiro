export const SHOPPING_PRIORITIES = [
  { value: "baixa", label: "Baixa", color: "#9AACAA", weight: 0 },
  { value: "media", label: "Média", color: "#5FA498", weight: 1 },
  { value: "alta", label: "Alta", color: "#228E9A", weight: 2 },
  { value: "urgente", label: "Urgente", color: "#f87171", weight: 3 },
] as const;

export const PURCHASE_TYPES = [
  { value: "necessidade", label: "Necessidade", color: "#5FA498" },
  { value: "desejo", label: "Desejo", color: "#fbbf24" },
  { value: "investimento_pessoal", label: "Investimento pessoal", color: "#228E9A" },
  { value: "presente", label: "Presente", color: "#a78bfa" },
  { value: "estudo", label: "Estudo", color: "#22d3ee" },
  { value: "tecnologia", label: "Tecnologia", color: "#20656C" },
  { value: "lazer", label: "Lazer", color: "#ec4899" },
  { value: "outro", label: "Outro", color: "#94a3b8" },
] as const;

export const SHOPPING_PAYMENTS = [
  { value: "debito_pix", label: "Débito / Pix" },
  { value: "credito_vista", label: "Crédito à vista" },
  { value: "credito_parcelado", label: "Crédito parcelado" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "outro", label: "Outro" },
] as const;

export const SHOPPING_STATUS = [
  { value: "planejado", label: "Planejado", color: "#9AACAA" },
  { value: "em_analise", label: "Em análise", color: "#22d3ee" },
  { value: "aprovado", label: "Aprovado", color: "#5FA498" },
  { value: "atencao", label: "Atenção", color: "#fbbf24" },
  { value: "inviavel", label: "Inviável", color: "#f87171" },
  { value: "comprado", label: "Comprado", color: "#228E9A" },
  { value: "adiado", label: "Adiado", color: "#20656C" },
  { value: "cancelado", label: "Cancelado", color: "#64748b" },
] as const;

const find = <T extends { value: string }>(arr: readonly T[], v?: string | null) =>
  arr.find((x) => x.value === v);

export const priorityLabel = (v?: string | null) => find(SHOPPING_PRIORITIES, v)?.label ?? "—";
export const priorityColor = (v?: string | null) => find(SHOPPING_PRIORITIES, v)?.color ?? "#94a3b8";
export const priorityWeight = (v?: string | null) => find(SHOPPING_PRIORITIES, v)?.weight ?? 0;
export const purchaseTypeLabel = (v?: string | null) => find(PURCHASE_TYPES, v)?.label ?? "—";
export const purchaseTypeColor = (v?: string | null) => find(PURCHASE_TYPES, v)?.color ?? "#94a3b8";
export const shoppingPaymentLabel = (v?: string | null) => find(SHOPPING_PAYMENTS, v)?.label ?? "—";
export const shoppingStatusLabel = (v?: string | null) => find(SHOPPING_STATUS, v)?.label ?? v ?? "—";
export const shoppingStatusColor = (v?: string | null) => find(SHOPPING_STATUS, v)?.color ?? "#94a3b8";
