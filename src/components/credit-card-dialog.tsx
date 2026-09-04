import { useState, type FormEvent, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import type { CreditCard } from "@/hooks/use-finance-data";

const schema = z.object({
  name: z.string().min(1).max(60),
  bank: z.string().max(60).nullable(),
  total_limit: z.number().min(0),
  used_limit: z.number().min(0),
  closing_day: z.number().int().min(1).max(31),
  due_day: z.number().int().min(1).max(31),
  color: z.string(),
});

export function CreditCardDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: CreditCard | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [total, setTotal] = useState("");
  const [used, setUsed] = useState("0");
  const [closing, setClosing] = useState(1);
  const [due, setDue] = useState(10);
  const [color, setColor] = useState("#22d3ee");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setBank(editing.bank ?? "");
      setTotal(String(editing.total_limit));
      setUsed(String(editing.used_limit));
      setClosing(editing.closing_day);
      setDue(editing.due_day);
      setColor(editing.color);
    } else if (open) {
      setName("");
      setBank("");
      setTotal("");
      setUsed("0");
      setClosing(1);
      setDue(10);
      setColor("#22d3ee");
    }
  }, [editing, open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      name,
      bank: bank || null,
      total_limit: parseFloat(total.replace(",", ".")) || 0,
      used_limit: parseFloat(used.replace(",", ".")) || 0,
      closing_day: closing,
      due_day: due,
      color,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const { used_limit: _usedLimit, ...cardData } = parsed.data;
      const payload = { ...cardData, user_id: u.user.id };
      const { error } = editing
        ? await supabase.from("credit_cards").update(payload).eq("id", editing.id)
        : await supabase.from("credit_cards").insert(payload);
      if (error) throw error;
      toast.success(editing ? "Cartão atualizado" : "Cartão criado");
      invalidateFinance(qc, "cards");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {editing ? "Editar cartão" : "Novo cartão de crédito"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Nubank"
                required
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label>Banco</Label>
              <Input
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                placeholder="Ex: Nubank"
                maxLength={60}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Limite total (R$)</Label>
              <Input
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Limite usado nas faturas (R$)</Label>
              <Input
                value={used}
                disabled
                onChange={(e) => setUsed(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Fechamento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={closing}
                onChange={(e) => setClosing(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label>Vencimento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={due}
                onChange={(e) => setDue(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <Input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 p-1"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={saving}
            className="w-full bg-gradient-primary text-primary-foreground shadow-glow"
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
