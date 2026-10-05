import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wallet, PiggyBank, Banknote, CreditCard, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import type { FinancialOverviewRow, AccountBalance } from "@/hooks/use-finance-aggregates";
import type { InvestmentSummary } from "@/hooks/use-app-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/global-wallet")({
  component: GlobalWallet,
  head: () => ({ meta: [
    { title: "Carteira Global | Furushima Financeiro" },
    { name: "description", content: "Visão consolidada do capital disponível e investido." },
    { property: "og:title", content: "Carteira Global | Furushima Financeiro" },
    { property: "og:description", content: "Visão consolidada do capital disponível e investido." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});
export interface GlobalWalletData {
  overview: FinancialOverviewRow;
  accounts: AccountBalance[];
  investment_summary: InvestmentSummary;
  unassigned_balance: number;
  net_worth: number;
}
function GlobalWallet() {
  const query = useQuery({
    queryKey: financeKeys.globalWallet,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_global_wallet");
      if (error) throw error;
      return data as unknown as GlobalWalletData;
    },
  });
  const data = query.data;
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto space-y-6">
      <header>
        <p className="text-xs text-muted-foreground">Todo o seu capital em uma visão</p>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">
          Carteira Global
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Contas, dinheiro físico e valor atual dos investimentos.
        </p>
      </header>
      {query.isLoading ? (
        <p>Carregando seu patrimônio...</p>
      ) : query.isError || !data ? (
        <div role="alert">
          <p>Não foi possível carregar a carteira.</p>
          <Button onClick={() => query.refetch()} variant="outline">
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-2"><StatCard label="Capital global" value={formatCurrency(data.overview.patrimonio_total)} icon={Wallet} gradient hint="Saldo disponível + valor atual dos investimentos" /></div>
            <StatCard
              label="Disponível nas contas"
              value={formatCurrency(data.overview.saldo_disponivel)}
              icon={Banknote}
              hint="Saldo em contas e dinheiro físico"
            />
            <div className="col-span-2"><StatCard
              label="Investimentos, valor atual"
              value={formatCurrency(data.overview.valor_atual_investimentos)}
              icon={PiggyBank}
              accent="success"
            /></div>
            <StatCard
              label="Capital aplicado"
              value={formatCurrency(data.overview.total_investido)}
              icon={PiggyBank}
            />
            <StatCard
              label="Resultado das posições"
              value={formatCurrency(data.overview.rendimento_total)}
              icon={TrendingUp}
              accent={data.overview.rendimento_total >= 0 ? "success" : "destructive"}
            />
            <StatCard
              label="Após faturas pendentes"
              value={formatCurrency(data.net_worth)}
              icon={CreditCard}
              hint={`Faturas em aberto: ${formatCurrency(data.overview.faturas_abertas)}`}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="furushima-accent">
              <CardHeader>
                <CardTitle className="font-display text-lg">Contas e dinheiro físico</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.accounts.length ? (
                  data.accounts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 border-b border-border/50 pb-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-words">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.type === "cash" ? "Dinheiro físico" : "Conta"}
                        </p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">{formatCurrency(a.balance)}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>
                )}
                {Math.abs(data.unassigned_balance) >= 0.01 && (
                  <div className="text-sm">
                    <p>Saldo de lançamentos sem conta: {formatCurrency(data.unassigned_balance)}</p>
                    <p className="text-xs text-muted-foreground">
                      Associe esses lançamentos a uma conta para detalhar o saldo.
                    </p>
                  </div>
                )}
                <Button asChild variant="outline">
                  <Link to="/accounts">Ver contas</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-primary/25">
              <CardHeader>
                <CardTitle className="font-display text-lg">Carteira de Investimentos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-display text-2xl font-bold">
                  {formatCurrency(data.investment_summary.value)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Aplicado: {formatCurrency(data.investment_summary.invested)}. Resultado:{" "}
                  {formatCurrency(data.investment_summary.profit)}.
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.investment_summary.manual_count} posições com valor manual.{" "}
                  {data.investment_summary.pending_count} aguardando cotação.
                </p>
                <p className="text-xs text-muted-foreground">
                  Reserva de emergência já faz parte dos investimentos. Limite de cartão, receitas
                  previstas e metas não entram como capital adicional.
                </p>
                <Button asChild variant="outline">
                  <Link to="/investments">Ver investimentos</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Aportes e resgates transferem capital entre contas e investimentos. A cotação altera o
            valor de mercado e preserva o saldo da conta. Valores manuais e cotações antigas
            continuam identificados na carteira de investimentos.
          </p>
        </>
      )}
    </div>
  );
}
