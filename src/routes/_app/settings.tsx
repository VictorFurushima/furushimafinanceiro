import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useCategoryLimits } from "@/hooks/use-finance-data";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { data: categories = [] } = useCategories();
  const { data: limits = [] } = useCategoryLimits();
  const qc = useQueryClient();

  const [newCat, setNewCat] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");
  const [newCatColor, setNewCatColor] = useState("#22d3ee");

  const [limitCat, setLimitCat] = useState("");
  const [limitAmount, setLimitAmount] = useState("");

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("categories").insert({
      user_id: u.user.id, name: newCat.trim(), type: newCatType, color: newCatColor, icon: "circle",
    });
    if (error) return toast.error(error.message);
    toast.success("Categoria criada");
    qc.invalidateQueries({ queryKey: ["categories"] });
    setNewCat("");
  };

  const delCategory = async (id: string) => {
    if (!confirm("Excluir esta categoria?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const setLimit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseFloat(limitAmount.replace(",", "."));
    if (!limitCat || !v || v <= 0) return toast.error("Preencha categoria e valor");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("category_limits").upsert({
      user_id: u.user.id, category_id: limitCat, monthly_limit: v,
    }, { onConflict: "user_id,category_id" });
    if (error) return toast.error(error.message);
    toast.success("Limite definido");
    qc.invalidateQueries({ queryKey: ["category_limits"] });
    setLimitAmount("");
  };

  const delLimit = async (id: string) => {
    const { error } = await supabase.from("category_limits").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["category_limits"] });
  };

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <h1 className="font-display text-4xl font-bold">Configurações</h1>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Categorias</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addCategory} className="grid grid-cols-1 md:grid-cols-[1fr,140px,80px,auto] gap-3">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nome da categoria" maxLength={50} />
            <Select value={newCatType} onValueChange={(v) => setNewCatType(v as "income" | "expense")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
              </SelectContent>
            </Select>
            <Input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} className="h-10" />
            <Button type="submit" className="bg-gradient-primary text-primary-foreground">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 group">
                <span className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                  {c.name}
                  <span className="text-xs text-muted-foreground">({c.type === "income" ? "receita" : "despesa"})</span>
                </span>
                <button onClick={() => delCategory(c.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Limites mensais por categoria</CardTitle>
          <p className="text-xs text-muted-foreground">Receba alertas quando uma categoria ultrapassar o limite</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={setLimit} className="grid grid-cols-1 md:grid-cols-[1fr,200px,auto] gap-3">
            <Select value={limitCat} onValueChange={setLimitCat}>
              <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
              <SelectContent>
                {categories.filter((c) => c.type === "expense").map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)} placeholder="Limite (R$)" inputMode="decimal" />
            <Button type="submit" className="bg-gradient-primary text-primary-foreground">Salvar</Button>
          </form>
          <ul className="space-y-2">
            {limits.map((l) => {
              const cat = categories.find((c) => c.id === l.category_id);
              return (
                <li key={l.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <span className="text-sm">{cat?.name ?? "—"}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{formatCurrency(Number(l.monthly_limit))}</span>
                    <button onClick={() => delLimit(l.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader><CardTitle className="font-display">Preferências</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
            <span>Moeda padrão</span>
            <span className="font-medium text-foreground">Real (R$)</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
            <span>Tema</span>
            <span className="font-medium text-foreground">Dark mode</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
