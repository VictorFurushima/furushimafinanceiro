const PG_CODE_MESSAGES: Record<string, string> = {
  "23503": "Não é possível excluir este item porque há registros financeiros ligados a ele.",
  "23505": "Já existe um registro com esses dados.",
  "23514": "Os dados informados não atendem às regras financeiras.",
  "42501": "Você não tem permissão para concluir esta ação.",
};

const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/Invalid login credentials/i, "E-mail ou senha incorretos."],
  [/Email not confirmed/i, "Confirme seu e-mail antes de entrar."],
  [/User already registered/i, "Já existe uma conta com este e-mail."],
  [/Password should be at least/i, "A senha não atende ao tamanho mínimo exigido."],
  [
    /Email rate limit exceeded|rate limit/i,
    "Muitas tentativas seguidas. Aguarde um pouco e tente novamente.",
  ],
  [
    /Signups not allowed|signup.*disabled/i,
    "A criação de novas contas está temporariamente desativada.",
  ],
  [
    /Failed to fetch|NetworkError|network request failed/i,
    "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.",
  ],
  [
    /active_credit_card_required|Compra no credito exige cartao/i,
    "Selecione o cartão usado nesta cobrança.",
  ],
  [
    /Ciclo ja pago|ciclo.*pago/i,
    "Esta fatura já foi paga. Estorne o pagamento antes de alterar as compras.",
  ],
  [
    /Estorne o pagamento da fatura/i,
    "Estorne o pagamento da fatura antes de alterar ou excluir esta compra.",
  ],
  [
    /Fatura invalida, paga ou valor divergente/i,
    "A fatura já foi paga, não existe ou teve o valor alterado.",
  ],
  [
    /Pagamento exige fatura e conta pagadora|Selecione a conta pagadora/i,
    "Selecione a conta usada para pagar a fatura.",
  ],
  [
    /Administrador obrigatorio|exige administrador titular/i,
    "Apenas o administrador deste espaço pode concluir esta ação.",
  ],
  [/(Conta|Categoria|Cartao).*outro titular/i, "O item selecionado pertence a outro espaço."],
  [
    /foreign key constraint|violates foreign key/i,
    "Não é possível excluir este item porque há registros financeiros ligados a ele.",
  ],
  [/duplicate key|unique constraint/i, "Já existe um registro com esses dados."],
  [/check constraint|violates check/i, "Revise os valores e as datas informados."],
];

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function friendlyError(
  error: unknown,
  fallback = "Não foi possível concluir esta ação",
): string {
  if (!error || typeof error !== "object") return fallback;
  const candidate = error as ErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message.trim() : "";

  for (const [pattern, friendly] of MESSAGE_RULES) {
    if (pattern.test(message)) return friendly;
  }
  if (code && PG_CODE_MESSAGES[code]) return PG_CODE_MESSAGES[code];

  return message || fallback;
}
