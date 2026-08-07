import { useEffect, useState, type FormEvent } from "react";
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
import { useAuth } from "@/hooks/use-auth";
import { useInvestments, useShoppingItems, type Note } from "@/hooks/use-app-data";
import { useGoals, useRecentTransactions } from "@/hooks/use-finance-data";
import { toISODate } from "@/lib/format";

export const NOTE_LINK_TYPES = [
  { value: "geral", label: "Nota geral" },
  { value: "transacao", label: "Transação" },
  { value: "investimento", label: "Investimento" },
  { value: "meta", label: "Meta" },
  { value: "compra", label: "Compra planejada" },
] as const;

export const noteLinkLabel = (v?: string | null) =>
  NOTE_LINK_TYPES.find((t) => t.value === v)?.label ?? "Nota geral";

export function NoteDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: Note | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: investments = [] } = useInvestments();
  const { data: goals = [] } = useGoals();
  const { data: shopping = [] } = useShoppingItems();
  const { data: transactions = [] } = useRecentTransactions(50);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [noteDate, setNoteDate] = useState(toISODate(new Date()));
  const [linkType, setLinkType] = useState("geral");
  const [linkId, setLinkId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setContent(editing?.content ?? "");
    setNoteDate(editing?.note_date ?? toISODate(new Date()));
    setLinkType(editing?.link_type ?? "geral");
    setLinkId(editing?.link_id ?? "");
  }, [open, editing]);

  const options =
    linkType === "investimento" ? investments.map((i) => ({ id: i.id, label: i.name }))
    : linkType === "meta" ? goals.map((g) => ({ id: g.id, label: g.name }))
    : linkType === "compra" ? shopping.map((s) => ({ id: s.id, label: s.item }))
    : linkType === "transacao" ? transactions.map((t) => ({ id: t.id, label: t.description || t.occurred_at }))
    : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Informe um título");
    if (!user) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      content,
      note_date: noteDate,
      link_type: linkType,
      link_id: linkType === "geral" ? null : linkId || null,
      user_id: user.id,
      created_by: user.id,
    };
    const { error } = editing
      ? await supabase.from("notes").update(payload).eq("id", editing.id)
      : await supabase.from("notes").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Nota atualizada" : "Nota criada");
    invalidateFinance(qc, "notes");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Editar nota" : "Nova nota"}</DialogTitle>
          <DialogDescription>Registre observações, planos e lembretes financeiros.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-title">Título</Label>
            <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-content">Conteúdo</Label>
            <Textarea id="note-content" value={content} onChange={(e) => setContent(e.target.value)} rows={6} maxLength={5000} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="note-date">Data</Label>
              <Input id="note-date" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Vincular a</Label>
              <Select value={linkType} onValueChange={(v) => { setLinkType(v); setLinkId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTE_LINK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {linkType !== "geral" && (
            <div className="space-y-2">
              <Label>Item vinculado</Label>
              <Select value={linkId} onValueChange={setLinkId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
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
