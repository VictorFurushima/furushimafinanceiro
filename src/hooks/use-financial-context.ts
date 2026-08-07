import { useMemo } from "react";
import { useGoals } from "@/hooks/use-finance-data";
import { useFinancialOverview } from "@/hooks/use-finance-aggregates";
import type { ContextoFinanceiro } from "@/lib/shopping-analysis";

export interface FinancialOverview {
  saldoDisponivel: number;
  totalInvestido: number;
  valorAtualInvestimentos: number;
  rendimentoTotal: number;
  patrimonioTotal: number;
  gastosReaisMes: number;
  receitasReaisMes: number;
  aportesMes: number;
  resgatesMes: number;
  contexto: ContextoFinanceiro;
  loading: boolean;
}

/**
 * Todo o cálculo pesado acontece no Postgres (get_financial_overview).
 * Aqui só montamos o contexto do planejador com metas (payload pequeno).
 */
export function useFinancialContext(): FinancialOverview {
  const { data: ov, isLoading } = useFinancialOverview();
  const { data: goals = [] } = useGoals();

  return useMemo(() => {
    const o = ov;
    const receitasPrevistasSeguras = o?.receitas_previstas_seguras ?? 0;
    const receitasReaisMes = o?.receitas_reais_mes ?? 0;
    const saldoDisponivel = o?.saldo_disponivel ?? 0;
    const valorAtualInvestimentos = o?.valor_atual_investimentos ?? 0;

    const contexto: ContextoFinanceiro = {
      saldoDisponivel,
      contasPendentes: o?.contas_pendentes ?? 0,
      faturasAbertas: o?.faturas_abertas ?? 0,
      reservaMinima: o?.min_reserve ?? 0,
      receitasPrevistasSeguras: receitasPrevistasSeguras || receitasReaisMes,
      gastosFixos: o?.gastos_fixos ?? 0,
      faturasPrevistas: o?.faturas_previstas ?? 0,
      aportesProgramados: o?.aportes_programados ?? 0,
      metasObrigatorias: 0,
      maxFreeBalancePct: o?.max_free_balance_pct ?? 30,
      maxIncomeInstallmentPct: o?.max_income_installment_pct ?? 20,
      rendaMensal: receitasPrevistasSeguras || receitasReaisMes,
      orcamentoCategoria: null,
      metas: goals.map((g) => ({
        id: g.id,
        name: g.name,
        target_amount: Number(g.target_amount),
        current_amount: Number(g.current_amount),
      })),
    };

    return {
      saldoDisponivel,
      totalInvestido: o?.total_investido ?? 0,
      valorAtualInvestimentos,
      rendimentoTotal: o?.rendimento_total ?? 0,
      patrimonioTotal: o?.patrimonio_total ?? saldoDisponivel + valorAtualInvestimentos,
      gastosReaisMes: o?.gastos_reais_mes ?? 0,
      receitasReaisMes,
      aportesMes: o?.aportes_mes ?? 0,
      resgatesMes: o?.resgates_mes ?? 0,
      contexto,
      loading: isLoading,
    };
  }, [ov, goals, isLoading]);
}
