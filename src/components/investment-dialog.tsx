import { useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import type { Investment } from "@/hooks/use-app-data";
import {
  INVESTMENT_TYPES,
  LIQUIDITY_OPTIONS,
  RISK_OPTIONS,
  INVESTMENT_STATUS,
  investmentTypeColor,
} from "@/lib/investment-constants";
import { toISODate } from "@/lib/format";

const parseNum = (v: string) => parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0;

const schema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  inv_type: z.string().min(1),
  institution: z.string().max(120).nullable(),
  invested_amount: z.number().min(0),
  current_amount: z.number().min(0),
  initial_amount: z.number().min(0),
  applied_at: z.string().min(1),
  maturity_date: z.string().nullable(),
  liquidity: z.string(),
  risk: z.string(),
  objective: z.string().max(200).nullable(),
  notes: z.string().max(1000).nullable(),
  status: z.string(),
  is_emergency_reserve: z.boolean(),
});

export function InvestmentDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: Investment | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("cdb");
  const [institution, setInstitution] = useState("");
  const [invested, setInvested] = useState("");
  const [current, setCurrent] = useState("");
  const [initial, setInitial] = useState("");
  const [appliedAt, setAppliedAt] = useState(toISODate(new Date()));
  const [maturity, setMaturity] = useState("");
  const [liquidity, setLiquidity] = useState("diaria");
  const [risk, setRisk] = useState("baixo");
  const [objective, setObjective] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("ativo");
  const [reserve, setReserve] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setType(editing.inv_type);
      setInstitution(editing.institution ?? "");
      setInvested(String(editing.invested_amount));
      setCurrent(String(editing.current_amount));
      setInitial(String(editing.initial_amount));
      setAppliedAt(editing.applied_at);
      setMaturity(editing.maturity_date ?? "");
      setLiquidity(editing.liquidity);
      setRisk(editing.risk);
      setObjective(editing.objective ?? "");
      setNotes(editing.notes ?? "");
      setStatus(editing.status);
      setReserve(editing.is_emergency_reserve);
    } else if (open) {
      setName("");
      setType("cdb");
      setInstitution("");
      setInvested("");
      setCurrent("");
      setInitial("");
      setAppliedAt(toISODate(new Date()));
      setMaturity("");
      setLiquidity("diaria");
      setRisk("baixo");
      setObjective("");
      setNotes("");
      setStatus("ativo");
      setReserve(false);
    }
  }, [editing, open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const investedN = parseNum(invested);
    const parsed = schema.safeParse({
      name,
      inv_type: type,
      institution: institution.trim() || null,
      invested_amount: investedN,
      current_amount: current ? parseNum(current) : investedN,
      initial_amount: initial ? parseNum(initial) : investedN,
      applied_at: appliedAt,
      maturity_date: maturity || null,
      liquidity,
      risk,
      objective: objective.trim() || null,
      notes: notes.trim() || null,
      status,
      is_emergency_reserve: reserve,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const payload = { ...parsed.data, color: investmentTypeColor(type), user_id: u.user.id };
      if (editing) {
        const { error } = await supabase.from("investments").update(payload).eq("id", editing.id);
        if (error) throw error;
        await supabase.from("investment_events").insert({
          user_id: u.user.id,
          investment_id: editing.id,
          event_type: "alteracao",
          amount: 0,
          previous_amount: editing.current_amount,
          new_amount: parsed.data.current_amount,
          notes: "Cadastro atualizado",
        });
      } else {
        const { error } = await supabase.from("investments").insert(payload);
        if (error) throw error;
      }
      toast.success(editing ? "Investimento atualizado" : "Investimento criado");
      invalidateFinance(qc, "investments");
      onOpenChange(false);
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
          <DialogTitle className="font-display text-2xl">
            {editing ? "Editar investimento" : "Novo investimento"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inv-name">Nome</Label>
            <Input
              id="inv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: CDB Banco X 110% CDI"
              required
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVESTMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-inst">Instituição</Label>
              <Input
                id="inv-inst"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Ex: Nubank, XP..."
                maxLength={120}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="inv-initial">Aplicado inicialmente (R$)</Label>
              <Input
                id="inv-initial"
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-invested">Valor investido (R$)</Label>
              <Input
                id="inv-invested"
                value={invested}
                onChange={(e) => setInvested(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-current">Valor atual (R$)</Label>
              <Input
                id="inv-current"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="inv-applied">Data de aplicação</Label>
              <Input
                id="inv-applied"
                type="date"
                value={appliedAt}
                onChange={(e) => setAppliedAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-maturity">Vencimento (opcional)</Label>
              <Input
                id="inv-maturity"
                type="date"
                value={maturity}
                onChange={(e) => setMaturity(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Liquidez</Label>
              <Select value={liquidity} onValueChange={setLiquidity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIQUIDITY_OPTIONS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Risco</Label>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVESTMENT_STATUS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-obj">Objetivo</Label>
            <Input
              id="inv-obj"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Ex: Reserva, aposentadoria, viagem"
              maxLength={200}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/40">
            <div>
              <p className="text-sm font-medium">Reserva de emergência</p>
              <p className="text-xs text-muted-foreground">
                Destaca este investimento como reserva
              </p>
            </div>
            <Switch
              checked={reserve}
              onCheckedChange={setReserve}
              aria-label="Reserva de emergência"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-notes">Observações</Label>
            <Textarea
              id="inv-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={2}
            />
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
