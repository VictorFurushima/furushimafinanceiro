import { useMemo } from "react";
import {
  useAccounts, useTransactions, useRecurring, useRecharges,
  useCreditCardBills, useGoals, useCategoryLimits,
} from "@/hooks/use-finance-data";
import { useInvestments, useUserSettings, DEFAULT_SETTINGS } from "@/hooks/use-app-data";
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

const isRealFlow = (flow?: string | null) => (flow ?? "real") === "real";

export function useFinancialContext(): FinancialOverview {
  const { data: accounts = [], isLoading: l1 } = useAccounts();
  const { data: transactions = [], isLoading: l2 } = useTransactions();
  const { data: recurring = [] } = useRecurring();
  const { data: recharges = [] } = useRecharges();
  const { data: bills = [] } = useCreditCardBills();
  const { data: goals = [] } = useGoals();
  const { data: limits = [] } = useCategoryLimits();
  const { data: investments = [], isLoading: l3 } = useInvestments();
  const { data: settingsRow } = useUserSettings();

  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow ?? {}) };

  return useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const inMonth = (iso: string) => {
      const d = new Date(iso);
      return d >= monthStart && d <= monthEnd;
    };

    // Saldo disponível: contas e carteira física (todos os movimentos afetam a conta)
    const saldoDisponivel =
      accounts.reduce((s, a) => s + Number(a.initial_balance), 0) +
      transactions.reduce(
        (s, t) => s + (t.type === "income" ? Number(t.amount) : -Number(t.amount)),
        0,
      );

    const ativos = investments.filter((i) => i.status !== "resgatado");
    const totalInvestido = ativos.reduce((s, i) => s + i.invested_amount, 0);
    const valorAtualInvestimentos = ativos.reduce((s, i) => s + i.current_amount, 0);
    const rendimentoTotal = valorAtualInvestimentos - totalInvestido;

    const mes = transactions.filter((t) => inMonth(t.occurred_at));
    const gastosReaisMes = mes
      .filter((t) => t.type === "expense" && isRealFlow(t.flow))
      .reduce((s, t) => s + Number(t.amount), 0);
    const receitasReaisMes = mes
      .filter((t) => t.type === "income" && isRealFlow(t.flow))
      .reduce((s, t) => s + Number(t.amount), 0);
    const aportesMes = mes
      .filter((t) => t.flow === "contribution")
      .reduce((s, t) => s + Number(t.amount), 0);
    const resgatesMes = mes
      .filter((t) => t.flow === "redemption")
      .reduce((s, t) => s + Number(t.amount), 0);

    const gastosFixos = recurring
      .filter((r) => r.status === "active" && r.frequency === "monthly")
      .reduce((s, r) => s + Number(r.amount), 0);
    const contasPendentes = recurring
      .filter((r) => r.status === "active" && r.frequency === "monthly" && r.billing_day >= now.getDate())
      .reduce((s, r) => s + Number(r.amount), 0);
    const faturasAbertas = bills
      .filter((b) => b.status !== "paga")
      .reduce((s, b) => s + Number(b.amount), 0);
    const faturasPrevistas = bills
      .filter((b) => b.status !== "paga" && inMonth(b.due_date))
      .reduce((s, b) => s + Number(b.amount), 0);

    // Apenas receitas seguras (recorrentes / fixas). Receita variável não entra.
    const receitasPrevistasSeguras = recharges
      .filter((r) => r.recharge_type === "fixed_income")
      .filter((r) => r.status === "prevista" || r.status === "confirmada" || r.status === "recebida")
      .filter((r) => inMonth(r.expected_date))
      .reduce((s, r) => s + r.expected_amount, 0);

    const aportesProgramados = settings.reminder_enabled ? Number(settings.reminder_amount) : 0;

    const contexto: ContextoFinanceiro = {
      saldoDisponivel,
      contasPendentes,
      faturasAbertas,
      reservaMinima: Number(settings.min_reserve),
      receitasPrevistasSeguras: receitasPrevistasSeguras || receitasReaisMes,
      gastosFixos,
      faturasPrevistas,
      aportesProgramados,
      metasObrigatorias: 0,
      maxFreeBalancePct: Number(settings.max_free_balance_pct),
      maxIncomeInstallmentPct: Number(settings.max_income_installment_pct),
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
      totalInvestido,
      valorAtualInvestimentos,
      rendimentoTotal,
      patrimonioTotal: saldoDisponivel + valorAtualInvestimentos,
      gastosReaisMes,
      receitasReaisMes,
      aportesMes,
      resgatesMes,
      contexto,
      loading: l1 || l2 || l3,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, transactions, recurring, recharges, bills, goals, limits, investments, settingsRow, l1, l2, l3]);
}
