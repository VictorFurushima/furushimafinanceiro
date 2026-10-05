export interface FinancialAction {
  id: string;
  root_table: string;
  root_operation: "INSERT" | "UPDATE" | "DELETE";
  description: string | null;
  created_at: string;
  reverted_at: string | null;
  reversal_of: string | null;
  change_count: number;
}
export interface HistoryChange {
  table: string;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
export interface HistoryConflict {
  table: string;
  id: string;
  reason: string;
}
export interface FinancialHistory {
  count: number;
  rows: FinancialAction[];
}
export interface FinancialActionDetail {
  action: FinancialAction;
  changes: HistoryChange[];
  conflicts: HistoryConflict[];
  can_revert: boolean;
}
export interface ReversalResult {
  status: "reverted" | "already_reverted" | "conflict";
  conflicts?: HistoryConflict[];
}
export const HISTORY_AREAS: Record<string, string> = {
  transactions: "Lançamentos",
  accounts: "Contas",
  categories: "Categorias",
  budgets: "Orçamentos",
  category_limits: "Limites por categoria",
  credit_cards: "Cartões",
  credit_card_bills: "Faturas",
  credit_card_bill_items: "Parcelas",
  recurring_expenses: "Assinaturas",
  balance_recharges: "Recargas",
  goals: "Metas",
  investments: "Investimentos",
  investment_events: "Movimentações de investimento",
  shopping_items: "Planejador de compras",
  user_settings: "Preferências financeiras",
  profiles: "Perfil e cartão principal",
  uploaded_transaction_images: "Prints",
  ocr_detected_transactions: "Revisões de prints",
  ocr_import_receipts: "Importações de prints",
};
export const historyTitle = (action: FinancialAction) => {
  const verb = action.reversal_of
    ? "Reversão"
    : action.root_operation === "INSERT"
      ? "Cadastro"
      : action.root_operation === "DELETE"
        ? "Exclusão"
        : "Alteração";
  return `${verb} · ${HISTORY_AREAS[action.root_table] ?? "Área financeira"}`;
};
const hidden = new Set([
  "id",
  "user_id",
  "created_at",
  "updated_at",
  "processing_token",
  "processing_started_at",
  "content_hash",
  "source_key",
  "prompt_version",
  "storage_path",
  "image_url",
  "reference_verified",
  "transaction_key",
  "import_key",
  "account_scope",
]);
const fields: Record<string, string> = {
  amount: "Valor",
  type: "Tipo",
  description: "Descrição",
  occurred_at: "Data",
  account_id: "Conta",
  destination_account_id: "Conta de destino",
  credit_card_id: "Cartão",
  card_id: "Cartão",
  bill_id: "Fatura",
  category_id: "Categoria",
  notes: "Observações",
  payment_method: "Pagamento",
  flow: "Natureza",
  installment_count: "Quantidade de parcelas",
  installment_number: "Número da parcela",
  name: "Nome",
  bank: "Banco",
  last_four: "Últimos 4 dígitos",
  total_limit: "Limite total",
  used_limit: "Limite usado",
  closing_day: "Dia de fechamento",
  due_day: "Dia de vencimento",
  status: "Situação",
  due_date: "Vencimento",
  payment_date: "Data de pagamento",
  manual_amount: "Valor manual da fatura",
  month: "Mês",
  year: "Ano",
  initial_balance: "Saldo inicial",
  color: "Cor",
  icon: "Ícone",
  monthly_limit: "Limite mensal",
  billing_day: "Dia de cobrança",
  frequency: "Frequência",
  start_date: "Início",
  end_date: "Fim",
  target_amount: "Valor da meta",
  current_amount: "Valor atual",
  deadline: "Prazo",
  inv_type: "Tipo de investimento",
  institution: "Instituição",
  invested_amount: "Valor investido",
  initial_amount: "Valor inicial",
  applied_at: "Data da aplicação",
  maturity_date: "Vencimento",
  liquidity: "Liquidez",
  risk: "Risco",
  objective: "Objetivo",
  is_emergency_reserve: "Reserva de emergência",
  investment_id: "Investimento",
  event_type: "Movimentação",
  previous_amount: "Valor anterior",
  new_amount: "Novo valor",
  transaction_id: "Lançamento",
  item: "Compra",
  store: "Loja",
  link: "Link",
  price: "Preço",
  shipping: "Frete",
  discount: "Desconto",
  interest: "Juros",
  desired_date: "Data desejada",
  priority: "Prioridade",
  purchase_type: "Tipo de compra",
  installments: "Parcelas",
  down_payment: "Entrada",
  down_payment_transaction_id: "Lançamento da entrada",
  goal_id: "Meta",
  score: "Avaliação",
  recharge_type: "Tipo de recarga",
  expected_amount: "Valor previsto",
  expected_date: "Data prevista",
  converted_to_income: "Registrada como receita",
  is_recurring: "Recorrente",
  recurring_day: "Dia da recorrência",
  source_recharge_id: "Recarga de origem",
  recurring_id: "Assinatura",
  primary_card_id: "Cartão principal",
  primary_card_prompt_dismissed: "Oferta de cartão principal adiada",
  full_name: "Nome completo",
  email: "E-mail",
  avatar_url: "Foto do perfil",
  min_reserve: "Reserva mínima",
  max_free_balance_pct: "Limite de saldo livre (%)",
  max_income_installment_pct: "Limite de renda em parcelas (%)",
  allow_low_score_wants: "Permitir compras com avaliação baixa",
  min_priority_auto: "Prioridade mínima",
  purchase_alerts: "Alertas de compra",
  reminder_enabled: "Lembrete ativo",
  reminder_day: "Dia do lembrete",
  reminder_amount: "Valor do lembrete",
  reminder_message: "Mensagem do lembrete",
  reminder_investment_id: "Investimento do lembrete",
  reminder_last_shown: "Último lembrete",
  detected_date: "Data revisada",
  detected_amount: "Valor revisado",
  detected_type: "Tipo revisado",
  detected_description: "Descrição revisada",
  detected_payment_method: "Pagamento revisado",
  detected_account: "Conta identificada",
  suggested_category: "Categoria sugerida",
  suggested_category_id: "Categoria",
  review_account_id: "Conta escolhida",
  review_card_id: "Cartão escolhido",
  review_destination_account_id: "Destino escolhido",
  confidence_level: "Confiança da leitura",
  review_status: "Situação da revisão",
  possible_duplicate: "Possível duplicata",
  saved_transaction_id: "Lançamento salvo",
  raw_text: "Texto do print",
  issues: "Avisos",
  movement_kind: "Natureza da movimentação",
  transaction_status: "Situação da movimentação",
  external_reference: "Referência bancária",
  card_selection_source: "Origem da seleção do cartão",
  image_id: "Print",
  candidate_id: "Revisão",
  account_scope: "Origem financeira",
  bank_reference: "Referência bancária",
  import_key: "Identificador da importação",
  file_name: "Arquivo",
  processing_status: "Situação da leitura",
  ocr_confidence: "Confiança",
  delete_after_processing: "Excluir depois da leitura",
  error_message: "Erro da leitura",
  upload_date: "Data de envio",
  reference_date: "Data de referência",
  analysis_status: "Resultado da leitura",
  analysis_warnings: "Avisos da leitura",
  extracted_count: "Movimentações lidas",
};
const money = new Set([
  "amount",
  "total_limit",
  "used_limit",
  "manual_amount",
  "initial_balance",
  "monthly_limit",
  "target_amount",
  "current_amount",
  "invested_amount",
  "initial_amount",
  "previous_amount",
  "new_amount",
  "price",
  "shipping",
  "discount",
  "interest",
  "down_payment",
  "expected_amount",
  "min_reserve",
  "reminder_amount",
  "detected_amount",
]);
const values: Record<string, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  real: "Movimentação financeira",
  bill_payment: "Pagamento de fatura",
  contribution: "Aporte",
  redemption: "Resgate",
  contribute: "Aporte",
  redeem: "Resgate",
  update_value: "Atualização de valor",
  pix: "PIX",
  debito: "Débito",
  credito: "Crédito",
  dinheiro: "Dinheiro",
  boleto: "Boleto",
  transferencia: "Transferência",
  active: "Ativo",
  paused: "Pausado",
  cancelled: "Cancelado",
  ativo: "Ativo",
  resgatado: "Resgatado",
  pausado: "Pausado",
  aberta: "Aberta",
  paga: "Paga",
  atrasada: "Atrasada",
  prevista: "Prevista",
  confirmada: "Confirmada",
  recebida: "Recebida",
  cancelada: "Cancelada",
  planejado: "Planejada",
  comprado: "Comprada",
  concluido: "Concluída",
  monthly: "Mensal",
  weekly: "Semanal",
  yearly: "Anual",
  custom: "Personalizada",
  ocr_match: "Identificado no print",
  single_card: "Cartão único",
  primary_card: "Cartão principal",
  manual: "Escolha manual",
  saved: "Salva",
  pending: "Pendente",
  needs_review: "Revisar",
  ignored: "Ignorada",
  completed: "Concluída",
  payment: "Pagamento",
  refund: "Estorno",
  own_transfer: "Entre minhas contas",
  unknown: "Não identificada",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  baixo: "Baixo",
  alto: "Alto",
  diaria: "Diária",
  cash: "Carteira",
  bank: "Banco",
  digital: "Banco digital",
  complete: "Completa",
  partial: "Parcial",
  failed: "Falhou",
  processing: "Em processamento",
};
export function changedFields(change: HistoryChange) {
  const before = change.after ?? {},
    after = change.before ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        !hidden.has(key) &&
        JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
    )
    .map((key) => ({
      key,
      label: fields[key] ?? "Informação",
      current: before[key],
      restored: after[key],
    }));
}
export function historyValue(key: string, value: unknown, references: Record<string, string> = {}) {
  if (value === null || value === undefined || value === "") return "Não definido";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (money.has(key) && Number.isFinite(Number(value)))
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
      Number(value),
    );
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Nenhum";
  if (typeof value === "object") return "Dados registrados";
  const text = String(value);
  if (key.endsWith("_id")) return references[text] ?? "Cadastro vinculado";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    return text.slice(8, 10) + "/" + text.slice(5, 7) + "/" + text.slice(0, 4);
  if (/_at$|upload_date/.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(text))
    return new Date(text).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return values[text] ?? text;
}
export function historyReferences(
  changes: HistoryChange[],
  existing: Array<{ id: string; name: string }>,
) {
  const result: Record<string, string> = {};
  for (const row of existing) result[row.id] = row.name;
  for (const change of changes) {
    const row = change.before ?? change.after;
    const name = row?.name ?? row?.description ?? row?.item ?? row?.file_name;
    if (typeof name === "string" && name) result[change.id] = name;
  }
  return result;
}
