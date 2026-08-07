import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAccounts } from "@/hooks/use-finance-data";
import type { Investment } from "@/hooks/use-app-data";
import { formatCurrency, toISODate } from "@/lib/format";

const parseNum = (v: string) => parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0;

export type MoveKind = "aporte" | "resgate" | "valor";

export function InvestmentMoveDialog({
  open, onOpenChange, investment, kind,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  investment: Investment | null;
  kind: MoveKind;
}) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const titles: Record<MoveKind, string> = {
    aporte: "Registrar aporte",
    resgate: "Registrar resgate",
    valor: "Atualizar valor atual",
  };
  const descriptions: Record<MoveKind, string> = {
    aporte: "O valor sai da conta escolhida e vira patrimônio investido. Não é contabilizado como gasto.",
    resgate: "O valor sai do investimento e volta para a conta escolhida. Não é contabilizado como receita.",
    valor: "Registra o rendimento atualizando o valor atual do investimento.",
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!investment) return;
    const value = parseNum(amount);
    if (value <= 0) { toast.error("Informe um valor maior que zero"); return; }
    setSaving(true);
    try {
      const nullable = <T,>(v: T | null) => v as unknown as T;
      if (kind === "aporte") {
        const { error } = await supabase.rpc("invest_contribute", {
          p_investment_id: investment.id, p_amount: value, p_date: date,
          p_account_id: nullable(accountId || null), p_notes: nullable(notes || null),
        });
        if (error) throw error;
        toast.success("Aporte registrado");
      } else if (kind === "resgate") {
        const { error } = await supabase.rpc("invest_redeem", {
          p_investment_id: investment.id, p_amount: value, p_date: date,
          p_account_id: nullable(accountId || null), p_notes: nullable(notes || null),
        });
        if (error) throw error;
        toast.success("Resgate registrado");
      } else {
        const { error } = await supabase.rpc("invest_update_value", {
          p_investment_id: investment.id, p_new_amount: value, p_notes: nullable(notes || null),
        });

        if (error) throw error;
        toast.success("Valor atualizado");
      }
      invalidateFinance(qc, "investments");
      invalidateFinance(qc, "transactions");
      setAmount(""); setNotes("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{titles[kind]}</DialogTitle>
          <DialogDescription className="text-xs">{descriptions[kind]}</DialogDescription>
        </DialogHeader>
        {investment && (
          <p className="text-sm text-muted-foreground">
            {investment.name} · atual {formatCurrency(investment.current_amount)}
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mv-amount">{kind === "valor" ? "Novo valor atual (R$)" : "Valor (R$)"}</Label>
            <Input id="mv-amount" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00" inputMode="decimal" required />
          </div>
          {kind !== "valor" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="mv-date">Data</Label>
                <Input id="mv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>{kind === "aporte" ? "Conta de origem" : "Conta de destino"}</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="mv-notes">Observação</Label>
            <Textarea id="mv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </div>
          <Button type="submit" disabled={saving} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
            {saving ? "Salvando..." : "Confirmar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
