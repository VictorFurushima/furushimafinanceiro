export const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "debito", label: "Cartão de Débito" },
  { value: "credito", label: "Cartão de Crédito" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
] as const;

export const INCOME_SOURCES = [
  "Mesada",
  "Trabalho",
  "Freelance",
  "Venda",
  "Reembolso",
  "Investimentos",
  "Outros",
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

export const paymentLabel = (v?: string | null) =>
  PAYMENT_METHODS.find((p) => p.value === v)?.label ?? "—";
