import { useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAccounts, useCategories, useCreditCards } from "@/hooks/use-finance-data";
import { toISODate } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/finance-constants";

type TxType = "income" | "expense" | "transfer";

const schema = z
  .object({
    amount: z.number().positive("Valor deve ser maior que zero"),
    description: z.string().max(200).optional(),
    category_id: z.string().uuid().nullable(),
    account_id: z.string().uuid().nullable(),
    destination_account_id: z.string().uuid().nullable(),
    credit_card_id: z.string().uuid().nullable(),
    occurred_at: z.string(),
    type: z.enum(["income", "expense", "transfer"]),
    subcategory: z.string().max(80).optional(),
    payment_method: z.string().optional(),
    notes: z.string().max(500).optional(),
  })
  .refine(
    (d) =>
      d.type !== "transfer" ||
      (d.account_id && d.destination_account_id && d.account_id !== d.destination_account_id),
    { message: "A transferência precisa de contas de origem e destino diferentes" },
  )
  .refine((d) => d.type !== "expense" || d.payment_method !== "credito" || !!d.credit_card_id, {
    message: "Selecione o cartão da compra",
  });

export function TransactionDialog({
  open,
  onOpenChange,
  defaultType = "expense",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultType?: TxType;
}) {
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCreditCards();

  const [type, setType] = useState<TxType>(defaultType);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [cardId, setCardId] = useState<string>("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [subcategory, setSubcategory] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("pix");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setType(defaultType);
  }, [defaultType, open]);
  useEffect(() => {
    if (open && accounts.length > 0 && !accountId) setAccountId(accounts[0].id);
  }, [open, accounts, accountId]);

  const isTransfer = type === "transfer";
  const isCardPurchase = type === "expense" && paymentMethod === "credito";
  const filteredCats = categories.filter((c) => c.type === type);

  useEffect(() => {
    if (filteredCats.length > 0 && !filteredCats.find((c) => c.id === categoryId)) {
      setCategoryId(filteredCats[0].id);
    }
  }, [type, filteredCats, categoryId]);

  useEffect(() => {
    if (isCardPurchase && cards.length > 0 && !cardId) setCardId(cards[0].id);
  }, [isCardPurchase, cards, cardId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      amount: parseFloat(amount.replace(",", ".")),
      description: description || undefined,
      category_id: isTransfer ? null : categoryId || null,
      account_id: accountId || null,
      destination_account_id: isTransfer ? destinationId || null : null,
      credit_card_id: isCardPurchase ? cardId || null : null,
      occurred_at: date,
      type,
      subcategory: isTransfer ? undefined : subcategory || undefined,
      payment_method: isTransfer ? "transferencia" : paymentMethod || undefined,
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
        destination_account_id: parsed.data.destination_account_id,
        credit_card_id: parsed.data.credit_card_id,
        occurred_at: parsed.data.occurred_at,
        subcategory: parsed.data.subcategory ?? null,
        payment_method: parsed.data.payment_method ?? null,
        notes: parsed.data.notes ?? null,
        user_id: userData.user.id,
      });
      if (error) throw error;
      toast.success(isTransfer ? "Transferência registrada!" : "Transação adicionada!");
      invalidateFinance(qc, "transactions", "accounts", "cards");
      onOpenChange(false);
      setAmount("");
      setDescription("");
      setSubcategory("");
      setNotes("");
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
          <Tabs value={type} onValueChange={(v) => setType(v as TxType)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger
                value="expense"
                className="data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive"
              >
                Despesa
              </TabsTrigger>
              <TabsTrigger
                value="income"
                className="data-[state=active]:bg-success/20 data-[state=active]:text-success"
              >
                Receita
              </TabsTrigger>
              <TabsTrigger
                value="transfer"
                className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary-glow"
              >
                Transferência
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isTransfer ? "Ex: Transferência para poupança" : "Ex: Almoço, Salário..."
              }
              maxLength={200}
            />
          </div>

          {!isTransfer && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCats.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: c.color }}
                          />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subcategoria</Label>
                <Input
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  placeholder="Opcional"
                  maxLength={80}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{isTransfer ? "Conta de origem" : "Conta"}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isTransfer ? (
              <div className="space-y-2">
                <Label>Conta de destino</Label>
                <Select value={destinationId} onValueChange={setDestinationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.id !== accountId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Forma de pagamento</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {isCardPurchase && (
            <div className="space-y-2">
              <Label>Cartão da compra</Label>
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cartão" />
                </SelectTrigger>
                <SelectContent>
                  {cards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A compra consome o limite e entra na fatura do mês — o saldo da conta não muda.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Notas internas (opcional)"
            />
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full bg-gradient-primary text-primary-foreground shadow-glow"
          >
            {saving ? "Salvando..." : "Adicionar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
