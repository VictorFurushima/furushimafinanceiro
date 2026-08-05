import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Pencil, Trash2, Repeat, Calendar, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecharges, type BalanceRecharge } from "@/hooks/use-finance-data";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";
import {
  RECHARGE_TYPES, RECHARGE_STATUS, rechargeTypeLabel, rechargeTypeColor,
  rechargeStatusLabel, rechargeStatusColor,
} from "@/lib/finance-constants";
import { RechargeDialog } from "@/components/recharge-dialog";
import { StatCard } from "@/components/stat-card";

export const Route = createFileRoute("/_app/recharges")({ component: RechargesPage });

function RechargesPage() {
  const { data: recharges = [] } = useRecharges();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalanceRecharge | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const monthRecharges = recharges.filter((r) => {
    const d = new Date(r.expected_date);
    return d >= monthStart && d <= monthEnd;
  });

  const totalPrevisto = monthRecharges
    .filter((r) => r.status === "prevista" || r.status === "confirmada")
    .reduce((s, r) => s + r.expected_amount, 0);
  const totalRecebido = monthRecharges
    .filter((r) => r.status === "recebida")
    .reduce((s, r) => s + r.expected_amount, 0);
  const totalAtrasado = recharges
    .filter((r) => r.status === "atrasada")
    .reduce((s, r) => s + r.expected_amount, 0);

  const next = useMemo(() => {
    return recharges
      .filter((r) => r.status === "prevista" || r.status === "confirmada")
      .filter((r) => new Date(r.expected_date) >= new Date(now.toDateString()))
      .sort((a, b) => a.expected_date.localeCompare(b.expected_date))[0];
  }, [recharges]);

  const filtered = recharges.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (typeFilter !== "all" && r.recharge_type !== typeFilter) return false;
    return true;
  });

  const markReceived = async (r: BalanceRecharge) => {
    try {
      const { error } = await supabase.rpc("confirm_recharge_as_income", { p_recharge_id: r.id });
      if (error) throw error;
      toast.success(
        r.recharge_type === "bill_payment" || r.recharge_type === "limit_release"
          ? "Recarga marcada como recebida"
          : "Recarga convertida em receita",
      );
      qc.invalidateQueries({ queryKey: ["recharges"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta recarga?")) return;
    const { error } = await supabase.from("balance_recharges").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Recarga excluída");
    qc.invalidateQueries({ queryKey: ["recharges"] });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Previsão de entradas e liberação de limite</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Recargas de Saldo</h1>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}
          className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Plus className="h-4 w-4 mr-2" /> Nova recarga
        </Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Próxima recarga" value={next?.name ?? "—"} icon={Calendar}
          hint={next ? `${formatCurrency(next.expected_amount)} · ${new Date(next.expected_date).toLocaleDateString("pt-BR")}` : undefined} gradient />
        <StatCard label="Previsto no mês" value={formatCurrency(totalPrevisto)} icon={Repeat} accent="success" />
        <StatCard label="Recebido no mês" value={formatCurrency(totalRecebido)} icon={Check} accent="success" />
        <StatCard label="Atrasado" value={formatCurrency(totalAtrasado)} icon={AlertCircle} accent="destructive" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {RECHARGE_STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {RECHARGE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Todas as recargas</CardTitle></CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Nenhuma recarga cadastrada.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {filtered.map((r) => (
                <li key={r.id} className="py-3 flex items-center gap-4 flex-wrap">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${rechargeTypeColor(r.recharge_type)}25`, color: rechargeTypeColor(r.recharge_type) }}>
                    {r.is_recurring ? <Repeat className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <Badge variant="outline" className="text-[10px]" style={{ borderColor: rechargeStatusColor(r.status), color: rechargeStatusColor(r.status) }}>
                        {rechargeStatusLabel(r.status)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {rechargeTypeLabel(r.recharge_type)} · {new Date(r.expected_date).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-success">{formatCurrency(r.expected_amount)}</span>
                  <div className="flex items-center gap-1">
                    {r.status !== "recebida" && r.status !== "cancelada" && (
                      <Button size="icon" variant="ghost" onClick={() => markReceived(r)} title="Marcar como recebida">
                        <Check className="h-4 w-4 text-success" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RechargeDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
