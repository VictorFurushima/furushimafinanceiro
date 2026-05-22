import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet, CreditCard, PiggyBank, Banknote, TrendingUp, Trash2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccounts, useTransactions } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/accounts")({
  component: AccountsPage,
});

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  checking: Wallet, savings: PiggyBank, credit_card: CreditCard, cash: Banknote, investment: TrendingUp,
};
const typeLabels: Record<string, string> = {
  checking: "Conta corrente", savings: "Poupança", credit_card: "Cartão de crédito", cash: "Dinheiro", investment: "Investimento",
};

function AccountsPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [balance, setBalance] = useState("0");
  const [color, setColor] = useState("#4f46e5");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nome obrigatório");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("accounts").insert({
      user_id: u.user.id, name: name.trim(), type, initial_balance: parseFloat(balance.replace(",", ".")) || 0, color,
    });
    if (error) return toast.error(error.message);
    toast.success("Conta criada");
    qc.invalidateQueries({ queryKey: ["accounts"] });
    setOpen(false); setName(""); setBalance("0");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removida");
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-bold">Contas</h1>
        <Button onClick={() => setOpen(true)} className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Plus className="h-4 w-4 mr-2" /> Nova
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((a) => {
          const Icon = typeIcons[a.type] ?? Wallet;
          const flow = transactions
            .filter((t) => t.account_id === a.id)
            .reduce((s, t) => s + (t.type === "income" ? Number(t.amount) : -Number(t.amount)), 0);
          const total = Number(a.initial_balance) + flow;
          return (
            <Card key={a.id} className="bg-gradient-card border-border/50 shadow-card group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20" style={{ background: a.color }} />
              <CardContent className="p-6 relative">
                <div className="flex items-start justify-between">
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: `${a.color}25`, color: a.color }}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <button onClick={() => remove(a.id)} className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{typeLabels[a.type]}</p>
                <h3 className="font-display text-xl font-semibold">{a.name}</h3>
                <p className="mt-3 font-display text-2xl font-bold">{formatCurrency(total)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader><DialogTitle className="font-display text-2xl">Nova conta</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Nubank" maxLength={50} required />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Saldo inicial</Label>
                <Input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 p-1" />
              </div>
            </div>
            <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground shadow-glow">Criar</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
