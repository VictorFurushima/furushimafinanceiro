import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, CreditCard as CardIcon, FileText, Check, CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useCreditCards, useCreditCardBills, type CreditCard, type CreditCardBill } from "@/hooks/use-finance-data";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import { CreditCardDialog } from "@/components/credit-card-dialog";
import { BillDialog } from "@/components/bill-dialog";

export const Route = createFileRoute("/_app/cards")({ component: CardsPage });

function nextDueDate(dueDay: number): Date {
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (next < now) next = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  return next;
}

function CardsPage() {
  const { user } = useAuth();
  const { data: cards = [] } = useCreditCards();
  const { data: bills = [] } = useCreditCardBills();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CreditCard | null>(null);
  const [billOpen, setBillOpen] = useState(false);

  const remove = async (id: string) => {
    if (!confirm("Excluir este cartão?")) return;
    const { error } = await supabase.from("credit_cards").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Cartão excluído");
    invalidateFinance(qc, "cards");
  };

  const payBill = async (billId: string) => {
    const { error } = await supabase.rpc("pay_credit_card_bill", { p_bill_id: billId });
    if (error) { toast.error(error.message); return; }
    toast.success("Fatura paga — limite recarregado");
    invalidateFinance(qc, "cards");
  };

  /**
   * Integração financeira -> agenda: cria o compromisso de pagamento da fatura.
   * O índice parcial idx_calendar_events_finance_source garante idempotência.
   */
  const scheduleBill = async (b: CreditCardBill) => {
    if (!user) return;
    const cardName = cards.find((c) => c.id === b.card_id)?.name ?? "Cartão";
    const start = new Date(`${b.due_date}T09:00:00`);
    const end = new Date(start.getTime() + 30 * 60_000);
    const { error } = await supabase.from("calendar_events").insert({
      user_id: user.id,
      title: `Pagar fatura ${cardName} · ${formatCurrency(b.amount)}`,
      category: "financeiro",
      priority: "alta",
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: false,
      source_type: "credit_card_bill",
      source_id: b.id,
      sync_enabled: false,
    });
    if (error) {
      if (error.code === "23505") return toast.info("Esta fatura já está agendada.");
      return toast.error(error.message);
    }
    toast.success("Pagamento agendado na sua agenda");
    invalidateFinance(qc, "events");
  };

  const openBills = bills.filter((b) => b.status !== "paga");

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Limites, faturas e vencimentos</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">Cartões de Crédito</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBillOpen(true)}>
            <FileText className="h-4 w-4 mr-2" /> Nova fatura
          </Button>
          <Button onClick={() => { setEditing(null); setOpen(true); }}
            className="bg-gradient-primary text-primary-foreground shadow-glow">
            <Plus className="h-4 w-4 mr-2" /> Novo cartão
          </Button>
        </div>
      </header>

      {cards.length === 0 ? (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="py-16 text-center">
            <CardIcon className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum cartão cadastrado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => {
            const available = c.total_limit - c.used_limit;
            const usedPct = c.total_limit > 0 ? (c.used_limit / c.total_limit) * 100 : 0;
            const due = nextDueDate(c.due_day);
            const daysToDue = Math.ceil((due.getTime() - Date.now()) / 86400000);
            const lowLimit = usedPct >= 80;
            return (
              <Card key={c.id} className="bg-gradient-card border-border/50 shadow-card overflow-hidden">
                <div className="h-2" style={{ background: c.color }} />
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="font-display flex items-center gap-2">
                      <CardIcon className="h-5 w-5" style={{ color: c.color }} />
                      {c.name}
                    </CardTitle>
                    {c.bank && <p className="text-xs text-muted-foreground mt-1">{c.bank}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(c.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Limite usado</span>
                      <span className={lowLimit ? "text-destructive font-semibold" : ""}>
                        {formatCurrency(c.used_limit)} / {formatCurrency(c.total_limit)}
                      </span>
                    </div>
                    <Progress value={usedPct} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-2">
                      Disponível: <span className="text-success font-medium">{formatCurrency(available)}</span>
                    </p>
                  </div>
                  <div className="flex justify-between text-xs">
                    <div>
                      <p className="text-muted-foreground">Fechamento</p>
                      <p className="font-medium">Dia {c.closing_day}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Próximo vencimento</p>
                      <p className="font-medium">
                        {due.toLocaleDateString("pt-BR")}
                        {daysToDue <= 5 && (
                          <Badge variant="outline" className="ml-2 text-[10px] border-destructive text-destructive">
                            {daysToDue}d
                          </Badge>
                        )}
                      </p>
                    </div>
                  </div>
                  {(() => {
                    const cardOpenBills = openBills.filter((b) => b.card_id === c.id);
                    if (cardOpenBills.length === 0) return null;
                    return (
                      <div className="border-t border-border/50 pt-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Faturas em aberto</p>
                        {cardOpenBills.map((b) => (
                          <div key={b.id} className="flex items-center justify-between text-sm">
                            <span>{String(b.month).padStart(2, "0")}/{b.year} · {formatCurrency(b.amount)}</span>
                            <div className="flex gap-2 shrink-0">
                              <Button size="sm" variant="outline" onClick={() => scheduleBill(b)}>
                                <CalendarDays className="h-3 w-3 mr-1" /> Agendar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => payBill(b.id)}>
                                <Check className="h-3 w-3 mr-1" /> Pagar
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreditCardDialog open={open} onOpenChange={setOpen} editing={editing} />
      <BillDialog open={billOpen} onOpenChange={setBillOpen} />
    </div>
  );
}
