import { useState, type FormEvent, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCategories, useAccounts, type RecurringExpense } from "@/hooks/use-finance-data";
import { PAYMENT_METHODS, FREQUENCIES, RECURRING_STATUS } from "@/lib/finance-constants";
import { toISODate } from "@/lib/format";

const schema = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().positive(),
  category_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  payment_method: z.string(),
  billing_day: z.number().int().min(1).max(31),
  frequency: z.enum(["monthly", "weekly", "yearly", "custom"]),
  start_date: z.string(),
  end_date: z.string().optional().nullable(),
  status: z.enum(["active", "paused", "cancelled"]),
});

export function RecurringDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing?: RecurringExpense | null }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const expenseCats = categories.filter((c) => c.type === "expense");

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("credito");
  const [billingDay, setBillingDay] = useState(1);
  const [frequency, setFrequency] = useState<"monthly" | "weekly" | "yearly" | "custom">("monthly");
  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "cancelled">("active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setAmount(String(editing.amount));
      setCategoryId(editing.category_id ?? "");
      setAccountId(editing.account_id ?? "");
      setPaymentMethod(editing.payment_method ?? "credito");
      setBillingDay(editing.billing_day);
      setFrequency(editing.frequency);
      setStartDate(editing.start_date);
      setEndDate(editing.end_date ?? "");
      setStatus(editing.status);
    } else if (open) {
      setName(""); setAmount(""); setCategoryId(""); setAccountId("");
      setPaymentMethod("credito"); setBillingDay(1); setFrequency("monthly");
      setStartDate(toISODate(new Date())); setEndDate(""); setStatus("active");
    }
  }, [editing, open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      name, amount: parseFloat(amount.replace(",", ".")),
      category_id: categoryId || null, account_id: accountId || null,
      payment_method: paymentMethod, billing_day: billingDay,
      frequency, start_date: startDate,
      end_date: endDate || null, status,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos"); return; }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const payload = { ...parsed.data, user_id: u.user.id };
      const { error } = editing
        ? await supabase.from("recurring_expenses").update(payload).eq("id", editing.id)
        : await supabase.from("recurring_expenses").insert(payload);
      if (error) throw error;
      toast.success(editing ? "Atualizada" : "Assinatura criada");
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">
          {editing ? "Editar assinatura" : "Nova assinatura"}
        </DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Netflix, Spotify..." required maxLength={100} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" required />
            </div>
            <div className="space-y-2">
              <Label>Dia de cobrança</Label>
              <Input type="number" min={1} max={31} value={billingDay} onChange={(e) => setBillingDay(parseInt(e.target.value) || 1)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {expenseCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Frequência</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Início</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Término (opcional)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECURRING_STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={saving} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
