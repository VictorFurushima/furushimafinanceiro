import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAccounts, useCategories, useCreditCards } from "@/hooks/use-finance-data";
import { useFinancialContext } from "@/hooks/use-financial-context";
import type { ShoppingItem } from "@/hooks/use-app-data";
import { analisarViabilidadeCompra } from "@/lib/shopping-analysis";
import {
  SHOPPING_PRIORITIES, PURCHASE_TYPES, SHOPPING_PAYMENTS, SHOPPING_STATUS,
} from "@/lib/shopping-constants";
import { formatCurrency } from "@/lib/format";

const parseNum = (v: string) => parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0;

export function ShoppingDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: ShoppingItem | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCreditCards();
  const { contexto } = useFinancialContext();

  const [item, setItem] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [store, setStore] = useState("");
  const [link, setLink] = useState("");
  const [price, setPrice] = useState("");
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [interest, setInterest] = useState("0");
  const [desiredDate, setDesiredDate] = useState("");
  const [priority, setPriority] = useState("media");
  const [purchaseType, setPurchaseType] = useState("necessidade");
  const [payment, setPayment] = useState("debito_pix");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [installments, setInstallments] = useState("1");
  const [downPayment, setDownPayment] = useState("0");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("planejado");
  const [saveAsGoal, setSaveAsGoal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItem(editing?.item ?? "");
    setCategoryId(editing?.category_id ?? "");
    setStore(editing?.store ?? "");
    setLink(editing?.link ?? "");
    setPrice(editing ? String(editing.price) : "");
    setShipping(String(editing?.shipping ?? 0));
    setDiscount(String(editing?.discount ?? 0));
    setInterest(String(editing?.interest ?? 0));
    setDesiredDate(editing?.desired_date ?? "");
    setPriority(editing?.priority ?? "media");
    setPurchaseType(editing?.purchase_type ?? "necessidade");
    setPayment(editing?.payment_method ?? "debito_pix");
    setAccountId(editing?.account_id ?? "");
    setCardId(editing?.card_id ?? "");
    setInstallments(String(editing?.installments ?? 1));
    setDownPayment(String(editing?.down_payment ?? 0));
    setNotes(editing?.notes ?? "");
    setStatus(editing?.status ?? "planejado");
    setSaveAsGoal(false);
  }, [open, editing]);

  const entrada = useMemo(() => ({
    price: parseNum(price), shipping: parseNum(shipping), discount: parseNum(discount),
    interest: parseNum(interest), priority, purchase_type: purchaseType,
    payment_method: payment, installments: Math.max(1, Math.round(parseNum(installments) || 1)),
    down_payment: parseNum(downPayment), category_id: categoryId || null,
    desired_date: desiredDate || null,
  }), [price, shipping, discount, interest, priority, purchaseType, payment, installments, downPayment, categoryId, desiredDate]);

  const analise = useMemo(() => analisarViabilidadeCompra(entrada, contexto), [entrada, contexto]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return toast.error("Informe o item");
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      item: item.trim(),
      category_id: categoryId || null,
      store: store || null,
      link: link || null,
      price: entrada.price,
      shipping: entrada.shipping,
      discount: entrada.discount,
      interest: entrada.interest,
      desired_date: desiredDate || null,
      priority, purchase_type: purchaseType, payment_method: payment,
      account_id: accountId || null,
      card_id: cardId || null,
      installments: entrada.installments,
      down_payment: entrada.down_payment,
      notes: notes || null,
      status,
      score: analise.score,
    };

    let itemId = editing?.id ?? null;
    if (editing) {
      const { error } = await supabase.from("shopping_items").update(payload).eq("id", editing.id);
      if (error) { setSaving(false); return toast.error(error.message); }
    } else {
      const { data, error } = await supabase.from("shopping_items").insert(payload).select("id").single();
      if (error) { setSaving(false); return toast.error(error.message); }
      itemId = data.id;
    }

    if (saveAsGoal && itemId) {
      const { data: goal, error: gErr } = await supabase.from("goals").insert({
        user_id: user.id,
        name: `Compra: ${item.trim()}`,
        target_amount: analise.precoFinal,
        current_amount: 0,
        deadline: analise.plano?.dataSegura ?? desiredDate ?? null,
        notes: `Meta criada a partir do planejador de compras.`,
      }).select("id").single();
      if (gErr) toast.error(`Item salvo, mas a meta falhou: ${gErr.message}`);
      else {
        await supabase.from("shopping_items").update({ goal_id: goal.id }).eq("id", itemId);
        qc.invalidateQueries({ queryKey: ["goals"] });
      }
    }

    setSaving(false);
    toast.success(editing ? "Compra atualizada" : "Compra planejada salva");
    qc.invalidateQueries({ queryKey: ["shopping_items"] });
    onOpenChange(false);
  };

  const faixaColor =
    analise.faixa === "viavel" ? "text-success"
    : analise.faixa === "atencao" ? "text-warning"
    : "text-destructive";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Editar compra" : "Nova compra planejada"}</DialogTitle>
          <DialogDescription>A análise de viabilidade é calculada em tempo real.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sh-item">Item</Label>
              <Input id="sh-item" value={item} onChange={(e) => setItem(e.target.value)} maxLength={120} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-price">Preço</Label>
              <Input id="sh-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-shipping">Frete</Label>
              <Input id="sh-shipping" value={shipping} onChange={(e) => setShipping(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-discount">Desconto</Label>
              <Input id="sh-discount" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-interest">Juros</Label>
              <Input id="sh-interest" value={interest} onChange={(e) => setInterest(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-store">Loja</Label>
              <Input id="sh-store" value={store} onChange={(e) => setStore(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-link">Link</Label>
              <Input id="sh-link" value={link} onChange={(e) => setLink(e.target.value)} type="url" maxLength={500} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sh-date">Data desejada</Label>
              <Input id="sh-date" type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {categories.filter((c) => c.type === "expense").map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHOPPING_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de compra</Label>
              <Select value={purchaseType} onValueChange={setPurchaseType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PURCHASE_TYPES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHOPPING_PAYMENTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHOPPING_STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {payment === "credito_parcelado" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sh-inst">Parcelas</Label>
                  <Input id="sh-inst" value={installments} onChange={(e) => setInstallments(e.target.value)} inputMode="numeric" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sh-down">Entrada</Label>
                  <Input id="sh-down" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} inputMode="decimal" />
                </div>
              </>
            )}
            {(payment === "credito_parcelado" || payment === "credito_vista") ? (
              <div className="space-y-2">
                <Label>Cartão</Label>
                <Select value={cardId} onValueChange={setCardId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Conta</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sh-notes">Observações</Label>
              <Textarea id="sh-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Análise de viabilidade</p>
              <span className={`font-display text-lg font-bold ${faixaColor}`}>
                {analise.score}/100 · {analise.faixaLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{analise.mensagem}</p>
            <p className="text-xs">
              Preço final: <strong>{formatCurrency(analise.precoFinal)}</strong>
              {payment === "credito_parcelado" && <> · Parcela: <strong>{formatCurrency(analise.parcela)}</strong></>}
            </p>
            {analise.plano && (
              <p className="text-xs text-muted-foreground">
                Plano sugerido: guardar {formatCurrency(analise.plano.valorMensal)} por {analise.plano.meses} mês(es)
                — comprar com segurança a partir de {new Date(analise.plano.dataSegura).toLocaleDateString("pt-BR")}.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div>
              <Label htmlFor="sh-goal" className="text-sm">Criar meta de economia</Label>
              <p className="text-xs text-muted-foreground">Gera uma meta com o valor final da compra.</p>
            </div>
            <Switch id="sh-goal" checked={saveAsGoal} onCheckedChange={setSaveAsGoal} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground">
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
