import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Upload, FileCheck, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAccounts, useCategories, useCreditCards } from "@/hooks/use-finance-data";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/finance-constants";
import { isValidDateOnly } from "@/lib/date-only";

export const Route = createFileRoute("/_app/import")({ component: ImportPage });

interface Row {
  Data: string;
  Valor: string;
  Categoria?: string;
  Descrição?: string;
  "Forma de Pagamento"?: string;
  Tipo?: string;
  Cartão?: string;
  Conta?: string;
}

interface Parsed {
  occurred_at: string;
  amount: number;
  type: "income" | "expense";
  description: string | null;
  category_id: string | null;
  payment_method: string | null;
  credit_card_id: string | null;
  account_id: string | null;
  _row: number;
  _error?: string;
}

const rowSchema = z.object({
  Data: z.string().min(1),
  Valor: z.string().min(1),
});

function parseDate(s: string): string | null {
  // dd/mm/yyyy or yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidDateOnly(s) ? s : null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const candidate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isValidDateOnly(candidate) ? candidate : null;
  }
  return null;
}

function parseMoney(raw: string): number {
  let value = raw.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (value.includes(",") && value.includes(".")) {
    value =
      value.lastIndexOf(",") > value.lastIndexOf(".")
        ? value.replace(/\./g, "").replace(",", ".")
        : value.replace(/,/g, "");
  } else if (value.includes(",")) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, "");
  }
  return Number(value);
}

/** Linhas exportadas como transferência ou pagamento de fatura não são despesas novas. */
const NON_IMPORTABLE_TYPES = /transfer|pagamento de fatura/;

interface Lookups {
  categories: { id: string; name: string; type: string }[];
  cards: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}

/** Converte uma linha do CSV usando os cadastros atuais (recalculado quando eles carregam). */
function parseRow(r: Row, idx: number, { categories, cards, accounts }: Lookups): Parsed {
  const invalid = (error: string, fields: Partial<Parsed> = {}): Parsed => ({
    occurred_at: "",
    amount: 0,
    type: "expense",
    description: null,
    category_id: null,
    payment_method: null,
    credit_card_id: null,
    account_id: null,
    ...fields,
    _row: idx + 2,
    _error: error,
  });
  if (!rowSchema.safeParse(r).success) return invalid("Data e Valor obrigatórios");
  const date = parseDate(r.Data);
  const amt = parseMoney(r.Valor);
  if (!date) return invalid(`Data inválida: ${r.Data}`);
  if (!amt || isNaN(amt)) return invalid(`Valor inválido: ${r.Valor}`, { occurred_at: date });
  const tipo = (r.Tipo ?? "").toLowerCase().trim();
  if (NON_IMPORTABLE_TYPES.test(tipo))
    return invalid(
      "Transferências e pagamentos de fatura não entram por CSV: use Transações ou Cartões",
      { occurred_at: date, amount: Math.abs(amt) },
    );
  const type: "income" | "expense" =
    tipo.includes("entrada") || tipo.includes("receita") || (amt > 0 && tipo.includes("income"))
      ? "income"
      : "expense";
  const cat = categories.find(
    (c) => c.type === type && c.name.toLowerCase() === (r.Categoria ?? "").toLowerCase().trim(),
  );
  const pm = PAYMENT_METHODS.find(
    (p) =>
      p.label.toLowerCase() === (r["Forma de Pagamento"] ?? "").toLowerCase().trim() ||
      p.value === (r["Forma de Pagamento"] ?? "").toLowerCase().trim(),
  );
  const card = cards.find((c) => c.name.toLowerCase() === (r.Cartão ?? "").toLowerCase().trim());
  const accountName = (r.Conta ?? "").toLowerCase().trim();
  const account = accounts.find((a) => a.name.toLowerCase() === accountName);
  const base = {
    occurred_at: date,
    amount: Math.abs(amt),
    type,
    description: r.Descrição || null,
    category_id: cat?.id ?? null,
    payment_method: pm?.value ?? null,
  };
  if (pm?.value === "credito") {
    if (!card)
      return invalid("Compras no crédito exigem a coluna Cartão com um cartão cadastrado", base);
    return { ...base, credit_card_id: card.id, account_id: null, _row: idx + 2 };
  }
  if (accountName && !account) return invalid(`Conta não encontrada: ${r.Conta}`, base);
  return { ...base, credit_card_id: null, account_id: account?.id ?? null, _row: idx + 2 };
}

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5000;

function ImportPage() {
  const categoriesQuery = useCategories();
  const cardsQuery = useCreditCards();
  const accountsQuery = useAccounts();
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const cards = useMemo(() => cardsQuery.data ?? [], [cardsQuery.data]);
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  // Cadastros precisam estar carregados para casar categoria, cartao e conta de cada linha.
  const lookupsReady = categoriesQuery.isSuccess && cardsQuery.isSuccess && accountsQuery.isSuccess;
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const rows = useMemo(
    () => rawRows.map((r, idx) => parseRow(r, idx, { categories, cards, accounts })),
    [rawRows, categories, cards, accounts],
  );
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  const handleFile = (file: File) => {
    if (file.size > MAX_CSV_BYTES) {
      toast.error("O CSV deve ter no máximo 5 MB");
      return;
    }
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (res.data.length > MAX_CSV_ROWS) {
          toast.error(`O CSV deve ter no máximo ${MAX_CSV_ROWS} linhas`);
          setRawRows([]);
          return;
        }
        setRawRows(res.data);
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
        occurred_at: r.occurred_at,
        amount: r.amount,
        type: r.type,
        description: r.description,
        category_id: r.category_id,
        payment_method: r.payment_method,
        credit_card_id: r.credit_card_id,
        account_id: r.account_id,
      }));
      const { error } = await supabase.from("transactions").insert(payload);
      if (error) throw error;
      toast.success(`${valid.length} transações importadas!`);
      invalidateFinance(qc, "transactions");
      setRawRows([]);
    } catch (err) {
      toast.error(friendlyError(err, "Erro"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Importar CSV</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Colunas aceitas:{" "}
          <code className="text-primary">
            Data, Valor, Categoria, Descrição, Forma de Pagamento, Tipo, Cartão, Conta
          </code>
        </p>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardContent className="p-8">
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl py-12 cursor-pointer hover:border-primary transition">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">Clique para selecionar um arquivo CSV</p>
            <p className="text-xs text-muted-foreground">Datas em dd/mm/aaaa ou aaaa-mm-dd</p>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm">
                <FileCheck className="h-4 w-4 text-success" />
                {valid.length} válidas
              </span>
              {errors.length > 0 && (
                <span className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  {errors.length} com erro
                </span>
              )}
            </div>
            <Button
              onClick={importAll}
              disabled={importing || !lookupsReady || valid.length === 0}
              className="bg-gradient-primary text-primary-foreground shadow-glow"
            >
              {importing
                ? "Importando..."
                : !lookupsReady
                  ? "Carregando cadastros..."
                  : `Importar ${valid.length} transações`}
            </Button>
          </div>

          <Card className="bg-gradient-card border-border/50 shadow-card">
            <CardHeader>
              <CardTitle className="font-display">Pré-visualização</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="text-left py-2">Linha</th>
                    <th className="text-left">Data</th>
                    <th className="text-left">Tipo</th>
                    <th className="text-right">Valor</th>
                    <th className="text-left">Categoria</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r) => {
                    const cat = categories.find((c) => c.id === r.category_id);
                    return (
                      <tr key={r._row} className="border-b border-border/30">
                        <td className="py-2 text-muted-foreground">{r._row}</td>
                        <td>{r.occurred_at}</td>
                        <td>
                          <span
                            className={r.type === "income" ? "text-success" : "text-destructive"}
                          >
                            {r.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td className="text-right">{formatCurrency(r.amount)}</td>
                        <td>{cat?.name ?? "—"}</td>
                        <td>
                          {r._error ? (
                            <span className="text-destructive text-xs">{r._error}</span>
                          ) : (
                            <span className="text-success text-xs">OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 50 && (
                <p className="text-xs text-muted-foreground mt-3">+ {rows.length - 50} linhas...</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
