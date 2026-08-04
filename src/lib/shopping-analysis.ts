import { priorityWeight } from "./shopping-constants";

export interface CompraEntrada {
  price: number;
  shipping: number;
  discount: number;
  interest: number;
  priority: string;
  purchase_type: string;
  payment_method: string;
  installments: number;
  down_payment: number;
  category_id?: string | null;
  desired_date?: string | null;
}

export interface MetaAfetada {
  id: string;
  name: string;
  faltante: number;
  atrasoMeses: number;
}

export interface ContextoFinanceiro {
  saldoDisponivel: number;
  contasPendentes: number;
  faturasAbertas: number;
  reservaMinima: number;
  receitasPrevistasSeguras: number;
  gastosFixos: number;
  faturasPrevistas: number;
  aportesProgramados: number;
  metasObrigatorias: number;
  maxFreeBalancePct: number;
  maxIncomeInstallmentPct: number;
  rendaMensal: number;
  orcamentoCategoria?: { limite: number; gasto: number } | null;
  metas?: { id: string; name: string; target_amount: number; current_amount: number }[];
}

export type FaixaViabilidade = "viavel" | "atencao" | "risco" | "inviavel";

export interface PlanoCompra {
  valorNecessario: number;
  quantoFalta: number;
  valorMensal: number;
  meses: number;
  dataSegura: string;
}

export interface ResultadoViabilidade {
  precoFinal: number;
  parcela: number;
  impactoAtual: number;
  impactoMensal: number;
  saldoLivreAtual: number;
  saldoLivreMensal: number;
  score: number;
  faixa: FaixaViabilidade;
  faixaLabel: string;
  mensagem: string;
  positivos: string[];
  negativos: string[];
  estouraOrcamento: boolean;
  afetaAporte: boolean;
  metasAfetadas: MetaAfetada[];
  plano: PlanoCompra | null;
}

const FAIXAS: Record<FaixaViabilidade, { label: string; mensagem: string }> = {
  viavel: { label: "Viável", mensagem: "Compra viável. Ela cabe no seu planejamento financeiro." },
  atencao: {
    label: "Atenção",
    mensagem: "Compra possível, mas exige cuidado. Ela vai reduzir sua margem financeira.",
  },
  risco: {
    label: "Risco alto",
    mensagem: "Compra arriscada. Ela pode prejudicar seu orçamento ou suas metas.",
  },
  inviavel: {
    label: "Inviável",
    mensagem: "Compra inviável no momento. O ideal é adiar ou juntar dinheiro antes.",
  },
};

export function faixaDoScore(score: number): FaixaViabilidade {
  if (score >= 80) return "viavel";
  if (score >= 60) return "atencao";
  if (score >= 40) return "risco";
  return "inviavel";
}

export function calcularPrecoFinal(c: Pick<CompraEntrada, "price" | "shipping" | "discount" | "interest">) {
  return Math.max(0, (c.price || 0) + (c.shipping || 0) + (c.interest || 0) - (c.discount || 0));
}

/** Analisa a viabilidade de uma compra planejada dentro do contexto financeiro atual. */
export function analisarViabilidadeCompra(
  compra: CompraEntrada,
  ctx: ContextoFinanceiro,
): ResultadoViabilidade {
  const precoFinal = calcularPrecoFinal(compra);
  const parcelado = compra.payment_method === "credito_parcelado" && compra.installments > 1;
  const entrada = Math.min(compra.down_payment || 0, precoFinal);
  const parcela = parcelado
    ? Math.max(0, (precoFinal - entrada) / Math.max(1, compra.installments))
    : precoFinal;

  const saldoLivreAtual =
    ctx.saldoDisponivel - ctx.contasPendentes - ctx.faturasAbertas - ctx.reservaMinima;
  const saldoLivreMensal =
    ctx.receitasPrevistasSeguras -
    ctx.gastosFixos -
    ctx.faturasPrevistas -
    ctx.aportesProgramados -
    ctx.metasObrigatorias;

  const impactoAtual = parcelado ? entrada : precoFinal;
  const impactoMensal = parcelado ? parcela : 0;

  const positivos: string[] = [];
  const negativos: string[] = [];
  let score = 100;

  // ---- penalidades ----
  if (impactoAtual > saldoLivreAtual) {
    score -= 35;
    negativos.push("O valor ultrapassa o seu saldo livre disponível hoje.");
  } else {
    positivos.push("A compra cabe no seu saldo livre disponível.");
  }

  const limitePct = ctx.maxFreeBalancePct > 0 ? ctx.maxFreeBalancePct : 30;
  const comprometimento =
    saldoLivreMensal > 0 ? ((impactoMensal || impactoAtual) / saldoLivreMensal) * 100 : Infinity;
  if (comprometimento > limitePct) {
    score -= 20;
    negativos.push(
      `Compromete ${
        Number.isFinite(comprometimento) ? comprometimento.toFixed(0) : ">100"
      }% do seu saldo livre mensal (limite configurado: ${limitePct}%).`,
    );
  } else {
    positivos.push("Cabe dentro do seu saldo livre mensal.");
  }

  let estouraOrcamento = false;
  if (ctx.orcamentoCategoria && ctx.orcamentoCategoria.limite > 0) {
    const restante = ctx.orcamentoCategoria.limite - ctx.orcamentoCategoria.gasto;
    if (precoFinal > restante) {
      estouraOrcamento = true;
      score -= 15;
      negativos.push("Essa compra ultrapassa o orçamento da categoria.");
    } else {
      positivos.push("A compra está dentro do orçamento da categoria.");
    }
  }

  if (parcelado) {
    const pctRenda = ctx.rendaMensal > 0 ? (parcela / ctx.rendaMensal) * 100 : Infinity;
    if (pctRenda > (ctx.maxIncomeInstallmentPct || 20)) {
      score -= 12;
      negativos.push("A parcela representa uma fatia alta da sua renda mensal.");
    }
    if (parcela > 0) {
      score -= 5;
      negativos.push(`Aumenta suas faturas futuras em ${compra.installments}x.`);
    }
  } else if (compra.payment_method === "debito_pix" || compra.payment_method === "dinheiro") {
    if (saldoLivreAtual - precoFinal >= 0) {
      positivos.push("Pagamento à vista preservando sua reserva mínima.");
      score += 5;
    }
  }

  let afetaAporte = false;
  if (ctx.aportesProgramados > 0 && (impactoMensal || impactoAtual) > saldoLivreMensal) {
    afetaAporte = true;
    score -= 12;
    negativos.push("Essa compra pode atrapalhar seu aporte mensal.");
  } else if (ctx.aportesProgramados > 0) {
    positivos.push("Seu aporte mensal continua preservado.");
  }

  const metasAfetadas: MetaAfetada[] = [];
  const sobraParaMetas = saldoLivreMensal - (impactoMensal || 0);
  for (const m of ctx.metas ?? []) {
    const faltante = Math.max(0, m.target_amount - m.current_amount);
    if (faltante <= 0) continue;
    if (sobraParaMetas <= 0) {
      metasAfetadas.push({ id: m.id, name: m.name, faltante, atrasoMeses: 0 });
      continue;
    }
    const mesesAntes = faltante / Math.max(1, saldoLivreMensal);
    const mesesDepois = faltante / Math.max(1, sobraParaMetas);
    const atraso = Math.ceil(mesesDepois - mesesAntes);
    if (atraso > 0) metasAfetadas.push({ id: m.id, name: m.name, faltante, atrasoMeses: atraso });
  }
  if (metasAfetadas.length > 0) {
    score -= 10;
    negativos.push(`Pode atrasar ${metasAfetadas.length} meta(s) financeira(s).`);
  } else if ((ctx.metas ?? []).length > 0) {
    positivos.push("Não prejudica suas metas financeiras.");
  }

  if (compra.interest > 0 && precoFinal > 0 && compra.interest / precoFinal > 0.1) {
    score -= 10;
    negativos.push("Os juros representam uma parte alta do valor final.");
  }

  const pw = priorityWeight(compra.priority);
  if (pw === 0) {
    score -= 8;
    negativos.push("Prioridade baixa.");
  } else if (pw >= 2) {
    score += 5;
    positivos.push("Prioridade alta.");
  }

  if (compra.purchase_type === "desejo") {
    score -= 10;
    negativos.push("Classificada como desejo, não como necessidade.");
  }
  if (compra.purchase_type === "necessidade") {
    score += 8;
    positivos.push("Classificada como necessidade.");
  }
  if (compra.purchase_type === "investimento_pessoal" || compra.purchase_type === "estudo") {
    score += 6;
    positivos.push("Investimento pessoal com retorno de longo prazo.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const faixa = faixaDoScore(score);

  let plano: PlanoCompra | null = null;
  if (faixa === "risco" || faixa === "inviavel") {
    const quantoFalta = Math.max(0, precoFinal - Math.max(0, saldoLivreAtual));
    const valorMensal = Math.max(saldoLivreMensal * 0.5, 1);
    const meses = Math.max(1, Math.ceil(quantoFalta / valorMensal));
    const data = new Date();
    data.setMonth(data.getMonth() + meses);
    plano = {
      valorNecessario: precoFinal,
      quantoFalta,
      valorMensal: Math.round(valorMensal * 100) / 100,
      meses,
      dataSegura: data.toISOString().slice(0, 10),
    };
  }

  return {
    precoFinal,
    parcela,
    impactoAtual,
    impactoMensal,
    saldoLivreAtual,
    saldoLivreMensal,
    score,
    faixa,
    faixaLabel: FAIXAS[faixa].label,
    mensagem: FAIXAS[faixa].mensagem,
    positivos,
    negativos,
    estouraOrcamento,
    afetaAporte,
    metasAfetadas,
    plano,
  };
}

export interface ComparacaoPagamento {
  metodo: string;
  label: string;
  impactoImediato: number;
  impactoFuturo: number;
  risco: "baixo" | "medio" | "alto";
  vantagem: string;
  desvantagem: string;
}

export function compararFormasPagamento(
  compra: CompraEntrada,
  ctx: ContextoFinanceiro,
): ComparacaoPagamento[] {
  const total = calcularPrecoFinal(compra);
  const n = Math.max(1, compra.installments || 1);
  const parcela = total / n;
  const sobra = ctx.saldoDisponivel - ctx.reservaMinima;
  return [
    {
      metodo: "debito_pix",
      label: "Débito / Pix",
      impactoImediato: total,
      impactoFuturo: 0,
      risco: sobra - total < 0 ? "alto" : "baixo",
      vantagem: "Sem juros e sem dívida futura.",
      desvantagem: "Reduz o saldo da conta imediatamente.",
    },
    {
      metodo: "credito_vista",
      label: "Crédito à vista",
      impactoImediato: 0,
      impactoFuturo: total,
      risco: "medio",
      vantagem: "Mantém o dinheiro em conta até o vencimento da fatura.",
      desvantagem: "Concentra o valor inteiro na próxima fatura.",
    },
    {
      metodo: "credito_parcelado",
      label: `Crédito parcelado (${n}x)`,
      impactoImediato: 0,
      impactoFuturo: parcela,
      risco: parcela > ctx.rendaMensal * 0.2 ? "alto" : "medio",
      vantagem: "Dilui o impacto mensal em parcelas menores.",
      desvantagem: "Compromete faturas futuras e reduz o limite disponível.",
    },
    {
      metodo: "dinheiro",
      label: "Dinheiro",
      impactoImediato: total,
      impactoFuturo: 0,
      risco: sobra - total < 0 ? "alto" : "baixo",
      vantagem: "Controle total, sem dívida.",
      desvantagem: "Reduz a carteira física e não gera rastro automático.",
    },
  ];
}
