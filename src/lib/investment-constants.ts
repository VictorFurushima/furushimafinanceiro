export const INVESTMENT_TYPES = [
  { value: "cdb", label: "CDB", color: "#228E9A" },
  { value: "tesouro_selic", label: "Tesouro Selic", color: "#20656C" },
  { value: "tesouro_ipca", label: "Tesouro IPCA", color: "#328274" },
  { value: "tesouro_pre", label: "Tesouro Prefixado", color: "#5FA498" },
  { value: "lci", label: "LCI", color: "#153A47" },
  { value: "lca", label: "LCA", color: "#9AACAA" },
  { value: "fundos", label: "Fundos", color: "#22d3ee" },
  { value: "acoes", label: "Ações", color: "#34d399" },
  { value: "fiis", label: "FIIs", color: "#a78bfa" },
  { value: "cripto", label: "Criptomoedas", color: "#fbbf24" },
  { value: "poupanca", label: "Poupança", color: "#67e8f9" },
  { value: "reserva", label: "Reserva de emergência", color: "#DBE6E6" },
  { value: "outros", label: "Outros", color: "#94a3b8" },
] as const;

export const LIQUIDITY_OPTIONS = [
  { value: "diaria", label: "Diária (D+0)" },
  { value: "d1", label: "D+1" },
  { value: "d30", label: "D+30" },
  { value: "vencimento", label: "Somente no vencimento" },
  { value: "outra", label: "Outra" },
] as const;

export const RISK_OPTIONS = [
  { value: "baixo", label: "Baixo", color: "#5FA498" },
  { value: "medio", label: "Médio", color: "#fbbf24" },
  { value: "alto", label: "Alto", color: "#f87171" },
] as const;

export const INVESTMENT_STATUS = [
  { value: "ativo", label: "Ativo", color: "#228E9A" },
  { value: "resgatado", label: "Resgatado", color: "#9AACAA" },
  { value: "pausado", label: "Pausado", color: "#fbbf24" },
] as const;

export const INVESTMENT_EVENT_LABELS: Record<string, string> = {
  aporte: "Aporte",
  resgate: "Resgate",
  rendimento: "Atualização de valor",
  alteracao: "Alteração de cadastro",
};

export const investmentTypeLabel = (v?: string | null) =>
  INVESTMENT_TYPES.find((t) => t.value === v)?.label ?? "Outros";

export const investmentTypeColor = (v?: string | null) =>
  INVESTMENT_TYPES.find((t) => t.value === v)?.color ?? "#94a3b8";

export const riskLabel = (v?: string | null) =>
  RISK_OPTIONS.find((r) => r.value === v)?.label ?? "—";

export const riskColor = (v?: string | null) =>
  RISK_OPTIONS.find((r) => r.value === v)?.color ?? "#94a3b8";

export const liquidityLabel = (v?: string | null) =>
  LIQUIDITY_OPTIONS.find((l) => l.value === v)?.label ?? "—";

export const investmentStatusLabel = (v?: string | null) =>
  INVESTMENT_STATUS.find((s) => s.value === v)?.label ?? v ?? "—";

export const investmentStatusColor = (v?: string | null) =>
  INVESTMENT_STATUS.find((s) => s.value === v)?.color ?? "#94a3b8";
