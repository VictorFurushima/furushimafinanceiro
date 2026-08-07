import { useState, type FormEvent, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAccounts, useCreditCards, type BalanceRecharge } from "@/hooks/use-finance-data";
import { PAYMENT_METHODS, RECHARGE_TYPES, RECHARGE_STATUS } from "@/lib/finance-constants";
import { toISODate } from "@/lib/format";

const schema = z.object({
  name: z.string().min(1).max(100),
  recharge_type: z.string().min(1),
  expected_amount: z.number().positive(),
  expected_date: z.string(),
  account_id: z.string().uuid().nullable(),
  card_id: z.string().uuid().nullable(),
  payment_method: z.string().nullable(),
  status: z.enum(["prevista", "confirmada", "recebida", "atrasada", "cancelada"]),
  notes: z.string().max(500).nullable(),
  is_recurring: z.boolean(),
  recurring_day: z.number().int().min(1).max(31).nullable(),
});

export function RechargeDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing?: BalanceRecharge | null }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCreditCards();

  const [name, setName] = useState("");
  const [type, setType] = useState("fixed_income");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [payment, setPayment] = useState("");
  const [status, setStatus] = useState<BalanceRecharge["status"]>("prevista");
  const [notes, setNotes] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState(1);
  const [saving, setSaving] = useState(false);

  const cardRelated = type === "bill_payment" || type === "limit_release";

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setType(editing.recharge_type);
      setAmount(String(editing.expected_amount));
      setDate(editing.expected_date);
      setAccountId(editing.account_id ?? "");
      setCardId(editing.card_id ?? "");
      setPayment(editing.payment_method ?? "");
      setStatus(editing.status);
      setNotes(editing.notes ?? "");
      setIsRecurring(editing.is_recurring);
      setRecurringDay(editing.recurring_day ?? 1);
    } else if (open) {
      setName(""); setType("fixed_income"); setAmount("");
      setDate(toISODate(new Date())); setAccountId(""); setCardId("");
      setPayment(""); setStatus("prevista"); setNotes("");
      setIsRecurring(false); setRecurringDay(1);
    }
  }, [editing, open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      name, recharge_type: type,
      expected_amount: parseFloat(amount.replace(",", ".")),
      expected_date: date,
      account_id: accountId || null,
      card_id: cardRelated ? (cardId || null) : null,
      payment_method: payment || null,
      status, notes: notes || null,
      is_recurring: isRecurring,
      recurring_day: isRecurring ? recurringDay : null,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos"); return; }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const payload = { ...parsed.data, user_id: u.user.id };
      const { error } = editing
        ? await supabase.from("balance_recharges").update(payload).eq("id", editing.id)
        : await supabase.from("balance_recharges").insert(payload);
      if (error) throw error;
      toast.success(editing ? "Recarga atualizada" : "Recarga criada");
      invalidateFinance(qc, "recharges");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {editing ? "Editar recarga" : "Nova recarga de saldo"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Salário, Freelance, Reembolso..." required maxLength={100} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECHARGE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor esperado (R$)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" required />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Data esperada</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as BalanceRecharge["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECHARGE_STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {cardRelated ? (
            <div className="space-y-2">
              <Label>Cartão relacionado</Label>
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger><SelectValue placeholder="Selecione um cartão" /></SelectTrigger>
                <SelectContent>
                  {cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Conta</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Forma de recebimento</Label>
                <Select value={payment} onValueChange={setPayment}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/40">
            <div>
              <p className="text-sm font-medium">Recarga recorrente</p>
              <p className="text-xs text-muted-foreground">Gera automaticamente todo mês</p>
            </div>
            <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
          </div>
          {isRecurring && (
            <div className="space-y-2">
              <Label>Dia do mês</Label>
              <Input type="number" min={1} max={31} value={recurringDay}
                onChange={(e) => setRecurringDay(parseInt(e.target.value) || 1)} />
            </div>
          )}
          <div className="space-y-2">
            <Label>Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
          </div>
          <Button type="submit" disabled={saving} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
