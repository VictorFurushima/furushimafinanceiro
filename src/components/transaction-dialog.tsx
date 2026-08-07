import { useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAccounts, useCategories } from "@/hooks/use-finance-data";
import { toISODate } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/finance-constants";

const schema = z.object({
  amount: z.number().positive("Valor deve ser maior que zero"),
  description: z.string().max(200).optional(),
  category_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  occurred_at: z.string(),
  type: z.enum(["income", "expense"]),
  subcategory: z.string().max(80).optional(),
  payment_method: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export function TransactionDialog({
  open, onOpenChange, defaultType = "expense",
}: { open: boolean; onOpenChange: (o: boolean) => void; defaultType?: "income" | "expense" }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();

  const [type, setType] = useState<"income" | "expense">(defaultType);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [subcategory, setSubcategory] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("pix");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setType(defaultType); }, [defaultType, open]);
  useEffect(() => {
    if (open && accounts.length > 0 && !accountId) setAccountId(accounts[0].id);
  }, [open, accounts, accountId]);

  const filteredCats = categories.filter((c) => c.type === type);

  useEffect(() => {
    if (filteredCats.length > 0 && !filteredCats.find((c) => c.id === categoryId)) {
      setCategoryId(filteredCats[0].id);
    }
  }, [type, filteredCats, categoryId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      amount: parseFloat(amount.replace(",", ".")),
      description: description || undefined,
      category_id: categoryId || null,
      account_id: accountId || null,
      occurred_at: date,
      type,
      subcategory: subcategory || undefined,
      payment_method: paymentMethod || undefined,
      notes: notes || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Não autenticado");
      const { error } = await supabase.from("transactions").insert({
        amount: parsed.data.amount,
        type: parsed.data.type,
        description: parsed.data.description ?? null,
        category_id: parsed.data.category_id,
        account_id: parsed.data.account_id,
        occurred_at: parsed.data.occurred_at,
        subcategory: parsed.data.subcategory ?? null,
        payment_method: parsed.data.payment_method ?? null,
        notes: parsed.data.notes ?? null,
        user_id: userData.user.id,
      });
      if (error) throw error;
      toast.success("Transação adicionada!");
      invalidateFinance(qc, "transactions");
      onOpenChange(false);
      setAmount(""); setDescription(""); setSubcategory(""); setNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Nova transação</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Tabs value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="expense" className="data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive">Despesa</TabsTrigger>
              <TabsTrigger value="income" className="data-[state=active]:bg-success/20 data-[state=active]:text-success">Receita</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Almoço, Salário..." maxLength={200} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {filteredCats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subcategoria</Label>
              <Input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="Opcional" maxLength={80} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} placeholder="Notas internas (opcional)" />
          </div>

          <Button type="submit" disabled={saving} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
            {saving ? "Salvando..." : "Adicionar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
