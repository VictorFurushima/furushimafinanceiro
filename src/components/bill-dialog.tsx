import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCreditCards } from "@/hooks/use-finance-data";

export function BillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: cards = [] } = useCreditCards();
  const today = new Date();
  const [cardId, setCardId] = useState("");
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cardId || !amount || !dueDate) { toast.error("Preencha todos os campos"); return; }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const { error } = await supabase.from("credit_card_bills").upsert({
        user_id: u.user.id,
        card_id: cardId,
        month, year,
        amount: parseFloat(amount.replace(",", ".")),
        due_date: dueDate,
        status: "aberta",
      }, { onConflict: "card_id,month,year" });
      if (error) throw error;
      toast.success("Fatura registrada");
      qc.invalidateQueries({ queryKey: ["credit_card_bills"] });
      onOpenChange(false);
      setCardId(""); setAmount(""); setDueDate("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader><DialogTitle className="font-display text-2xl">Nova fatura</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Cartão</Label>
            <Select value={cardId} onValueChange={setCardId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Mês</Label>
              <Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(parseInt(e.target.value) || 1)} />
            </div>
            <div className="space-y-2">
              <Label>Ano</Label>
              <Input type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(parseInt(e.target.value) || today.getFullYear())} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" required />
            </div>
            <div className="space-y-2">
              <Label>Vencimento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </div>
          </div>
          <Button type="submit" disabled={saving} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
            {saving ? "Salvando..." : "Salvar fatura"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
