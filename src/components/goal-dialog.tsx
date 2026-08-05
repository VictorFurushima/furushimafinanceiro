import { useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Goal } from "@/hooks/use-finance-data";

export function GoalDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing?: Goal | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [deadline, setDeadline] = useState("");
  const [color, setColor] = useState("#22d3ee");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name); setTarget(String(editing.target_amount));
      setCurrent(String(editing.current_amount)); setDeadline(editing.deadline ?? "");
      setColor(editing.color); setNotes(editing.notes ?? "");
    } else if (open) {
      setName(""); setTarget(""); setCurrent("0"); setDeadline("");
      setColor("#22d3ee"); setNotes("");
    }
  }, [editing, open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = parseFloat(target.replace(",", "."));
    const c = parseFloat((current || "0").replace(",", "."));
    if (!name || !t || t <= 0) return toast.error("Preencha nome e valor alvo");
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const payload = {
        name, target_amount: t, current_amount: c,
        deadline: deadline || null, color, notes: notes || null,
        user_id: u.user.id,
      };
      const { error } = editing
        ? await supabase.from("goals").update(payload).eq("id", editing.id)
        : await supabase.from("goals").insert(payload);
      if (error) throw error;
      toast.success(editing ? "Meta atualizada" : "Meta criada");
      qc.invalidateQueries({ queryKey: ["goals"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader><DialogTitle className="font-display text-2xl">
          {editing ? "Editar meta" : "Nova meta"}
        </DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Viagem, Reserva..." required maxLength={100} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor alvo (R$)</Label>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" required />
            </div>
            <div className="space-y-2">
              <Label>Valor atual (R$)</Label>
              <Input value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0,00" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Prazo</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </div>
          <Button type="submit" disabled={saving} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
