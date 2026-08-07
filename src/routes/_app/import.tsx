import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import Papa from "papaparse";
import { Upload, FileCheck, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/use-finance-data";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/finance-constants";

export const Route = createFileRoute("/_app/import")({ component: ImportPage });

interface Row {
  Data: string; Valor: string; Categoria?: string; Descrição?: string;
  "Forma de Pagamento"?: string; Tipo?: string;
}

interface Parsed {
  occurred_at: string; amount: number; type: "income" | "expense";
  description: string | null; category_id: string | null; payment_method: string | null;
  _row: number; _error?: string;
}

const rowSchema = z.object({
  Data: z.string().min(1),
  Valor: z.string().min(1),
});

function parseDate(s: string): string | null {
  // dd/mm/yyyy or yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function ImportPage() {
  const { data: categories = [] } = useCategories();
  const [rows, setRows] = useState<Parsed[]>([]);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  const handleFile = (file: File) => {
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const parsed: Parsed[] = res.data.map((r, idx) => {
          const v = rowSchema.safeParse(r);
          if (!v.success) return { occurred_at: "", amount: 0, type: "expense", description: null, category_id: null, payment_method: null, _row: idx + 2, _error: "Data e Valor obrigatórios" };
          const date = parseDate(r.Data);
          const amt = parseFloat(r.Valor.replace(/[R$\s.]/g, "").replace(",", "."));
          if (!date) return { occurred_at: "", amount: 0, type: "expense", description: null, category_id: null, payment_method: null, _row: idx + 2, _error: `Data inválida: ${r.Data}` };
          if (!amt || isNaN(amt)) return { occurred_at: date, amount: 0, type: "expense", description: null, category_id: null, payment_method: null, _row: idx + 2, _error: `Valor inválido: ${r.Valor}` };
          const type: "income" | "expense" = (r.Tipo ?? "").toLowerCase().includes("entrada") || (r.Tipo ?? "").toLowerCase().includes("receita") || amt > 0 && (r.Tipo ?? "").toLowerCase().includes("income") ? "income" : "expense";
          const cat = categories.find((c) => c.name.toLowerCase() === (r.Categoria ?? "").toLowerCase().trim());
          const pm = PAYMENT_METHODS.find((p) => p.label.toLowerCase() === (r["Forma de Pagamento"] ?? "").toLowerCase().trim() || p.value === (r["Forma de Pagamento"] ?? "").toLowerCase().trim());
          return {
            occurred_at: date, amount: Math.abs(amt), type,
            description: r.Descrição || null, category_id: cat?.id ?? null,
            payment_method: pm?.value ?? null, _row: idx + 2,
          };
        });
        setRows(parsed);
      },
      error: (err) => toast.error("Erro ao ler CSV: " + err.message),
    });
  };

  const valid = rows.filter((r) => !r._error);
  const errors = rows.filter((r) => r._error);

  const importAll = async () => {
    if (valid.length === 0) return;
    setImporting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const payload = valid.map((r) => ({
        user_id: u.user!.id,
        occurred_at: r.occurred_at, amount: r.amount, type: r.type,
        description: r.description, category_id: r.category_id, payment_method: r.payment_method,
      }));
      const { error } = await supabase.from("transactions").insert(payload);
      if (error) throw error;
      toast.success(`${valid.length} transações importadas!`);
      invalidateFinance(qc, "transactions");
      setRows([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setImporting(false); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Importar CSV</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Colunas aceitas: <code className="text-primary">Data, Valor, Categoria, Descrição, Forma de Pagamento, Tipo</code>
        </p>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardContent className="p-8">
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl py-12 cursor-pointer hover:border-primary transition">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">Clique para selecionar um arquivo CSV</p>
            <p className="text-xs text-muted-foreground">Datas em dd/mm/aaaa ou aaaa-mm-dd</p>
            <input type="file" accept=".csv" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (f) handleFile(f);
            }} />
          </label>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm"><FileCheck className="h-4 w-4 text-success" />{valid.length} válidas</span>
              {errors.length > 0 && <span className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-destructive" />{errors.length} com erro</span>}
            </div>
            <Button onClick={importAll} disabled={importing || valid.length === 0} className="bg-gradient-primary text-primary-foreground shadow-glow">
              {importing ? "Importando..." : `Importar ${valid.length} transações`}
            </Button>
          </div>

          <Card className="bg-gradient-card border-border/50 shadow-card">
            <CardHeader><CardTitle className="font-display">Pré-visualização</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border/50">
                  <tr><th className="text-left py-2">Linha</th><th className="text-left">Data</th><th className="text-left">Tipo</th><th className="text-right">Valor</th><th className="text-left">Categoria</th><th className="text-left">Status</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r) => {
                    const cat = categories.find((c) => c.id === r.category_id);
                    return (
                      <tr key={r._row} className="border-b border-border/30">
                        <td className="py-2 text-muted-foreground">{r._row}</td>
                        <td>{r.occurred_at}</td>
                        <td><span className={r.type === "income" ? "text-success" : "text-destructive"}>{r.type === "income" ? "Receita" : "Despesa"}</span></td>
                        <td className="text-right">{formatCurrency(r.amount)}</td>
                        <td>{cat?.name ?? "—"}</td>
                        <td>{r._error ? <span className="text-destructive text-xs">{r._error}</span> : <span className="text-success text-xs">OK</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 50 && <p className="text-xs text-muted-foreground mt-3">+ {rows.length - 50} linhas...</p>}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
