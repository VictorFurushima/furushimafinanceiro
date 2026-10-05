import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Settings2, ChartNoAxesCombined } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys, invalidateFinance } from "@/lib/query-keys";
import { friendlyError } from "@/lib/friendly-error";
import type { Investment } from "@/hooks/use-app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const formatUnitPrice = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 12,
  }).format(value);

const quoteTimestamp = (stamp?: string | null) =>
  stamp
    ? new Date(stamp).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Aguardando primeira cotação";

export function InvestmentQuoteStatus({ investment: i }: { investment: Investment }) {
  if (!i.provider || i.provider === "manual")
    return (
      <p className="text-xs text-muted-foreground">Valor manual, conforme cadastro ou extrato.</p>
    );
  return (
    <div className="text-xs text-muted-foreground space-y-1 mt-1">
      <p>
        {i.provider === "brapi" ? "brapi" : "CoinGecko"} · {i.asset_code} ·{" "}
        {i.quantity?.toLocaleString("pt-BR", { maximumFractionDigits: 12 })} unidades
      </p>
      <p>
        {i.unit_price != null
          ? `Preço unitário ${formatUnitPrice(i.unit_price)} · referência ${quoteTimestamp(i.quoted_at)}`
          : "Sem cotação. Exibindo o valor informado."}
      </p>
      {i.checked_at && <p>Última consulta: {quoteTimestamp(i.checked_at)}</p>}
      {i.valuation_status === "stale" && (
        <p className="text-warning">Consulta atrasada. Mantida a última cotação.</p>
      )}
      {i.quote_error && (
        <p className="text-warning">
          {i.quote_error}.{" "}
          {i.unit_price != null ? "Mantida a última cotação." : "Confira a configuração da fonte."}
        </p>
      )}
    </div>
  );
}

export function InvestmentQuoteControls({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("brapi");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: financeKeys.investmentProviders,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_investment_provider_status");
      if (error) throw error;
      return data as { brapi: boolean; coingecko: boolean };
    },
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc("refresh_investment_quotes");
      if (error) throw error;
      const result = data as { queued: number };
      toast.success(
        result.queued > 0
          ? "Consulta enviada. Os valores chegarão em até 2 minutos."
          : "Dados recarregados. Consultas respeitam o intervalo de 30 minutos.",
      );
      invalidateFinance(qc, "investments");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setRefreshing(false);
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.rpc("configure_investment_provider", {
        p_provider: provider,
        p_token: token,
      });
      if (error) throw error;
      setToken("");
      await qc.invalidateQueries({ queryKey: financeKeys.investmentProviders });
      toast.success("Chave salva com criptografia");
      setOpen(false);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <p className="text-sm font-medium">Acompanhamento a cada 30 minutos</p>
          <p className="text-xs text-muted-foreground mt-1">
            Consulta automática no servidor. A data da cotação depende da fonte e do horário do
            mercado.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {refreshing ? "Consultando..." : "Atualizar cotações"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Settings2 className="h-4 w-4 mr-2" />
              Fontes
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Valores de mercado são brutos. Não representam o saldo líquido para resgate. Produtos sem
        fonte conectada usam o valor informado no extrato.
      </p>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setToken("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fontes de cotação</DialogTitle>
            <DialogDescription>
              A chave fica criptografada no servidor e não aparece novamente. Use uma chave do seu
              plano da fonte.
            </DialogDescription>
          </DialogHeader>
          {status.isError ? (
            <p className="text-sm text-destructive">Não foi possível consultar as fontes.</p>
          ) : (
            <p className="text-sm">
              brapi: {status.data?.brapi ? "configurada" : "sem chave"}. CoinGecko:{" "}
              {status.data?.coingecko ? "configurada" : "sem chave"}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A brapi permite PETR4, VALE3, ITUB4 e MGLU3 sem chave. Outros ativos dependem da
            cobertura do seu plano. Criptomoedas usam uma chave Demo do CoinGecko.
          </p>
          <form onSubmit={save} className="space-y-3">
            <Label htmlFor="source-provider">Fonte</Label>
            <select
              id="source-provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setToken("");
              }}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            >
              <option value="brapi">brapi</option>
              <option value="coingecko">CoinGecko Demo</option>
            </select>
            <Label htmlFor="source-token">Chave de API</Label>
            <Input
              id="source-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              maxLength={500}
              autoComplete="off"
              placeholder="Cole sua chave"
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                Salvar chave
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const { error } = await supabase.rpc("configure_investment_provider", {
                      p_provider: provider,
                      p_token: "",
                    });
                    if (error) throw error;
                    setToken("");
                    await qc.invalidateQueries({ queryKey: financeKeys.investmentProviders });
                    toast.success("Chave removida");
                  } catch (error) {
                    toast.error(friendlyError(error));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Remover chave
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function InvestmentPriceHistory({ investment }: { investment: Investment }) {
  const [open, setOpen] = useState(false);
  const prices = useQuery({
    queryKey: financeKeys.investmentPrices(investment.id),
    enabled: open,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_investment_price_history", {
        p_id: investment.id,
      });
      if (error) throw error;
      return data as unknown as { quoted_at: string; price: number }[];
    },
  });
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Histórico de preço de ${investment.name}`}
      >
        <ChartNoAxesCombined className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{investment.asset_code}, preço unitário</DialogTitle>
            <DialogDescription>
              Última cotação de cada dia, nos últimos 90 dias. O histórico começa com o
              acompanhamento deste ativo.
            </DialogDescription>
          </DialogHeader>
          {prices.isError ? (
            <p>Não foi possível carregar as cotações.</p>
          ) : prices.isLoading ? (
            <p>Carregando...</p>
          ) : !prices.data?.length ? (
            <p>Aguardando a primeira cotação.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart
                data={prices.data.map((p) => ({
                  ...p,
                  date: new Date(p.quoted_at).toLocaleDateString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  }),
                }))}
              >
                <XAxis dataKey="date" fontSize={10} />
                <YAxis width={65} fontSize={10} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: number) => formatUnitPrice(v)} />
                <Area dataKey="price" name="Preço unitário" stroke="#5FA498" fill="#20656C" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
