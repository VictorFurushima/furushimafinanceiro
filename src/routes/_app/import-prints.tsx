import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload, ImageIcon, Loader2, CheckCircle2, AlertTriangle,
  Trash2, Save, ScanLine, Eye,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import { useCategories, useAccounts } from "@/hooks/use-finance-data";
import { PAYMENT_METHODS } from "@/lib/finance-constants";
import { formatCurrency } from "@/lib/format";
import { extractTransactionsFromImage } from "@/lib/ocr.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/import-prints")({ component: ImportPrintsPage });

interface DetectedTx {
  id: string;
  image_id: string;
  detected_date: string | null;
  detected_amount: number | null;
  detected_type: string | null;
  detected_description: string | null;
  detected_payment_method: string | null;
  detected_account: string | null;
  suggested_category: string | null;
  suggested_category_id: string | null;
  confidence_level: string | null;
  review_status: string;
  possible_duplicate: boolean;
}

interface ImageRow {
  id: string;
  file_name: string;
  storage_path: string;
  processing_status: string;
  ocr_confidence: string | null;
  error_message: string | null;
  upload_date: string;
}

const confColor = (c?: string | null) =>
  c === "alta" ? "bg-success/20 text-success border-success/40"
  : c === "baixa" ? "bg-destructive/20 text-destructive border-destructive/40"
  : "bg-warning/20 text-warning border-warning/40";

function ImportPrintsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const extract = useServerFn(extractTransactionsFromImage);
  const [uploading, setUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const { data: images = [] } = useQuery({
    queryKey: ["uploaded-prints"],
    queryFn: async (): Promise<ImageRow[]> => {
      const { data, error } = await supabase
        .from("uploaded_transaction_images")
        .select("*").order("upload_date", { ascending: false });
      if (error) throw error;
      return data as ImageRow[];
    },
  });

  const { data: detected = [] } = useQuery({
    queryKey: ["ocr-detected"],
    queryFn: async (): Promise<DetectedTx[]> => {
      const { data, error } = await supabase
        .from("ocr_detected_transactions")
        .select("*")
        .neq("review_status", "saved")
        .neq("review_status", "ignored")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DetectedTx[]).map((d) => ({
        ...d, detected_amount: d.detected_amount !== null ? Number(d.detected_amount) : null,
      }));
    },
  });

  const handleFiles = async (files: FileList) => {
    if (!user) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("transaction-prints")
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;

        const { data: imgRow, error: insErr } = await supabase
          .from("uploaded_transaction_images")
          .insert({
            user_id: user.id,
            file_name: file.name,
            storage_path: path,
            processing_status: "pending",
          })
          .select("id").single();
        if (insErr) throw insErr;

        toast.info(`Lendo ${file.name}...`);
        try {
          const result = await extract({ data: { imageId: imgRow.id, storagePath: path } });
          toast.success(`${result.count} transações identificadas em ${file.name}`);
        } catch (e) {
          toast.error(`Falha ao ler ${file.name}: ${e instanceof Error ? e.message : ""}`);
        }
      }
      qc.invalidateQueries({ queryKey: ["uploaded-prints"] });
      qc.invalidateQueries({ queryKey: ["ocr-detected"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const previewImage = async (img: ImageRow) => {
    if (previewUrls[img.id]) {
      setPreviewUrls((p) => { const n = { ...p }; delete n[img.id]; return n; });
      return;
    }
    const { data } = await supabase.storage
      .from("transaction-prints")
      .createSignedUrl(img.storage_path, 300);
    if (data?.signedUrl) setPreviewUrls((p) => ({ ...p, [img.id]: data.signedUrl }));
  };

  const deleteImage = async (img: ImageRow) => {
    if (!confirm("Excluir este print e suas transações detectadas?")) return;
    await supabase.storage.from("transaction-prints").remove([img.storage_path]);
    await supabase.from("uploaded_transaction_images").delete().eq("id", img.id);
    qc.invalidateQueries({ queryKey: ["uploaded-prints"] });
    qc.invalidateQueries({ queryKey: ["ocr-detected"] });
    toast.success("Print excluído");
  };

  const reprocess = async (img: ImageRow) => {
    toast.info(`Reprocessando ${img.file_name}...`);
    try {
      await supabase.from("ocr_detected_transactions").delete().eq("image_id", img.id);
      const result = await extract({ data: { imageId: img.id, storagePath: img.storage_path } });
      toast.success(`${result.count} transações identificadas`);
      qc.invalidateQueries({ queryKey: ["uploaded-prints"] });
      qc.invalidateQueries({ queryKey: ["ocr-detected"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <div className="p-3 sm:p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Importar por Print</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Envie prints de extratos, Pix, faturas ou comprovantes. O sistema lê automaticamente as transações.
        </p>
      </header>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardContent className="p-4 sm:p-8">
          <label className={cn(
            "flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl py-8 sm:py-12 cursor-pointer transition",
            uploading ? "opacity-50 pointer-events-none" : "hover:border-primary",
          )}>
            {uploading
              ? <Loader2 className="h-10 w-10 text-primary animate-spin" />
              : <Upload className="h-10 w-10 text-muted-foreground" />}
            <p className="text-sm font-medium text-center px-2">
              {uploading ? "Processando..." : "Clique ou arraste prints (JPG, PNG, WebP)"}
            </p>
            <p className="text-xs text-muted-foreground text-center px-2">
              Bancos, Pix, faturas, comprovantes — vários arquivos por vez
            </p>
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }} />
          </label>
        </CardContent>
      </Card>

      {images.length > 0 && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader><CardTitle className="font-display flex items-center gap-2">
            <ImageIcon className="h-5 w-5" /> Prints enviados
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {images.map((img) => (
              <div key={img.id} className="border border-border/50 rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm truncate max-w-[200px] sm:max-w-md">{img.file_name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {img.processing_status === "completed" ? "Lido"
                        : img.processing_status === "processing" ? "Processando"
                        : img.processing_status === "failed" ? "Erro"
                        : "Pendente"}
                    </Badge>
                    {img.ocr_confidence && (
                      <Badge variant="outline" className={cn("text-[10px]", confColor(img.ocr_confidence))}>
                        Confiança: {img.ocr_confidence}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => previewImage(img)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => reprocess(img)} title="Reler">
                      <ScanLine className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteImage(img)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {img.error_message && (
                  <p className="text-xs text-destructive">{img.error_message}</p>
                )}
                {previewUrls[img.id] && (
                  <img src={previewUrls[img.id]} alt={img.file_name}
                    className="max-h-96 rounded-md border border-border/50" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {detected.length > 0 && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader>
            <CardTitle className="font-display">
              Transações detectadas ({detected.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Revise, edite e confirme antes de salvar no histórico.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {detected.map((d) => (
              <DetectedRow key={d.id} tx={d}
                categories={categories} accounts={accounts}
                onChanged={() => {
                  qc.invalidateQueries({ queryKey: ["ocr-detected"] });
                  invalidateFinance(qc, "transactions");
                }} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetectedRow({ tx, categories, accounts, onChanged }: {
  tx: DetectedTx;
  categories: { id: string; name: string; type: string }[];
  accounts: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [date, setDate] = useState(tx.detected_date ?? "");
  const [amount, setAmount] = useState(tx.detected_amount?.toString() ?? "");
  const [type, setType] = useState<"income" | "expense">(
    tx.detected_type === "income" ? "income" : "expense",
  );
  const [description, setDescription] = useState(tx.detected_description ?? "");
  const [categoryId, setCategoryId] = useState(tx.suggested_category_id ?? "");
  const [accountId, setAccountId] = useState<string>("");
  const [payment, setPayment] = useState(tx.detected_payment_method ?? "");
  const [saving, setSaving] = useState(false);

  const filteredCats = categories.filter((c) => c.type === type);

  const save = async () => {
    if (!user) return;
    if (!date || !amount) {
      toast.error("Data e valor são obrigatórios");
      return;
    }
    if (tx.possible_duplicate && !confirm("Essa transação parece já ter sido registrada. Salvar mesmo assim?")) return;
    setSaving(true);
    try {
      const { data: ins, error } = await supabase.from("transactions").insert({
        user_id: user.id,
        occurred_at: date,
        amount: parseFloat(amount),
        type,
        description: description || null,
        category_id: categoryId || null,
        account_id: accountId || null,
        payment_method: payment || null,
      }).select("id").single();
      if (error) throw error;
      await supabase.from("ocr_detected_transactions")
        .update({ review_status: "saved", saved_transaction_id: ins.id })
        .eq("id", tx.id);
      toast.success("Transação salva!");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setSaving(false); }
  };

  const ignore = async () => {
    await supabase.from("ocr_detected_transactions")
      .update({ review_status: "ignored" }).eq("id", tx.id);
    onChanged();
  };

  return (
    <div className="border border-border/50 rounded-lg p-3 sm:p-4 space-y-3 bg-background/40">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn(
          type === "income" ? "bg-success/15 text-success border-success/30"
                            : "bg-destructive/15 text-destructive border-destructive/30",
        )}>
          {type === "income" ? "Entrada" : "Saída"} {amount && formatCurrency(parseFloat(amount) || 0)}
        </Badge>
        <Badge variant="outline" className={cn("text-[10px]", confColor(tx.confidence_level))}>
          Confiança: {tx.confidence_level ?? "—"}
        </Badge>
        {tx.possible_duplicate && (
          <Badge variant="outline" className="bg-warning/20 text-warning border-warning/40 text-[10px]">
            <AlertTriangle className="h-3 w-3 mr-1" /> Possível duplicada
          </Badge>
        )}
        {tx.confidence_level === "baixa" && (
          <span className="text-[11px] text-warning">Revise manualmente — leitura com baixa confiança</span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Data</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor</Label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Saída</SelectItem>
              <SelectItem value="income">Entrada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Pagamento</Label>
          <Select value={payment} onValueChange={setPayment}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 lg:col-span-2 space-y-1">
          <Label className="text-xs">Descrição</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Categoria {tx.suggested_category && <span className="text-primary">· sugerida: {tx.suggested_category}</span>}
          </Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Escolher" /></SelectTrigger>
            <SelectContent>
              {filteredCats.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Conta</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={ignore}>
          <Trash2 className="h-4 w-4 mr-1" /> Ignorar
        </Button>
        <Button size="sm" onClick={save} disabled={saving}
          className="bg-gradient-primary text-primary-foreground">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <Save className="h-4 w-4 ml-1" /> Salvar
        </Button>
      </div>
    </div>
  );
}
