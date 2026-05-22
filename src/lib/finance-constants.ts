export const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "debito", label: "Cartão de Débito" },
  { value: "credito", label: "Cartão de Crédito" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
] as const;

export const INCOME_SOURCES = [
  "Mesada", "Trabalho", "Freelance", "Venda", "Reembolso", "Investimentos", "Outros",
] as const;

export const FREQUENCIES = [
  { value: "monthly", label: "Mensal" },
  { value: "weekly", label: "Semanal" },
  { value: "yearly", label: "Anual" },
  { value: "custom", label: "Personalizada" },
] as const;

export const RECURRING_STATUS = [
  { value: "active", label: "Ativa" },
  { value: "paused", label: "Pausada" },
  { value: "cancelled", label: "Cancelada" },
] as const;

export const RECHARGE_TYPES = [
  { value: "fixed_income", label: "Receita fixa", color: "#22d3ee" },
  { value: "variable_income", label: "Receita variável prevista", color: "#67e8f9" },
  { value: "reimbursement", label: "Reembolso", color: "#34d399" },
  { value: "refund", label: "Estorno", color: "#a7f3d0" },
  { value: "limit_release", label: "Liberação de limite", color: "#a78bfa" },
  { value: "bill_payment", label: "Pagamento de fatura", color: "#f472b6" },
  { value: "investment_redemption", label: "Resgate de investimento", color: "#fbbf24" },
  { value: "other", label: "Outro", color: "#94a3b8" },
] as const;

export const RECHARGE_STATUS = [
  { value: "prevista", label: "Prevista", color: "oklch(0.70 0.10 220)" },
  { value: "confirmada", label: "Confirmada", color: "oklch(0.78 0.13 195)" },
  { value: "recebida", label: "Recebida", color: "oklch(0.74 0.15 165)" },
  { value: "atrasada", label: "Atrasada", color: "oklch(0.62 0.22 25)" },
  { value: "cancelada", label: "Cancelada", color: "oklch(0.55 0.02 215)" },
] as const;

export const BILL_STATUS = [
  { value: "aberta", label: "Aberta" },
  { value: "paga", label: "Paga" },
  { value: "atrasada", label: "Atrasada" },
] as const;

export const paymentLabel = (v?: string | null) =>
  PAYMENT_METHODS.find((p) => p.value === v)?.label ?? "—";

export const rechargeTypeLabel = (v?: string | null) =>
  RECHARGE_TYPES.find((t) => t.value === v)?.label ?? "—";

export const rechargeTypeColor = (v?: string | null) =>
  RECHARGE_TYPES.find((t) => t.value === v)?.color ?? "#94a3b8";

export const rechargeStatusLabel = (v?: string | null) =>
  RECHARGE_STATUS.find((s) => s.value === v)?.label ?? v ?? "—";

export const rechargeStatusColor = (v?: string | null) =>
  RECHARGE_STATUS.find((s) => s.value === v)?.color ?? "#94a3b8";
