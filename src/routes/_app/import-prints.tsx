import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, Loader2, Eye, ScanLine, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { financeKeys, invalidateFinance } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useCategories, useAccounts, useCreditCards } from "@/hooks/use-finance-data";
import { PAYMENT_METHODS } from "@/lib/finance-constants";
import { formatCurrency } from "@/lib/format";
import { formatDateOnlyPtBR, isValidDateOnly, todayISO } from "@/lib/date-only";
import { extractTransactionsFromImage } from "@/lib/ocr.functions";
import { sha256Hex } from "@/lib/ocr-schema";
import { friendlyError } from "@/lib/friendly-error";
import {
  newOcrDraft,
  ocrDraftReady,
  ocrFields,
  requiresOcrConfirmation,
  type OcrDraft,
  type OcrItem,
  type OcrReview,
  type OcrSaveResult,
} from "@/lib/ocr-review";

export const Route = createFileRoute("/_app/import-prints")({ component: ImportPrintsPage });
const PAGE_SIZE = 25;
interface ImageRow {
  id: string;
  file_name: string;
  storage_path: string;
  processing_status: string;
  error_message: string | null;
  reference_date: string;
  analysis_status: string;
  analysis_warnings: string[];
  extracted_count: number;
  upload_date: string;
}
const analysisLabels: Record<string, string> = {
  pending: "Aguardando leitura",
  complete: "Leitura completa",
  partial: "Leitura parcial",
  unreadable: "Imagem ilegível",
  not_financial: "Sem movimentações",
};

function ImportPrintsPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const extract = useServerFn(extractTransactionsFromImage);
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCreditCards();
  const [uploading, setUploading] = useState(false);
  const [referenceDate, setReferenceDate] = useState(todayISO());
  const [imageDates, setImageDates] = useState<Record<string, string>>({});
  const [imagePage, setImagePage] = useState(0);
  const [imageId, setImageId] = useState("all");
  const [state, setState] = useState("pending");
  const [page, setPage] = useState(0);
  const [defaultAccount, setDefaultAccount] = useState("");
  const [drafts, setDrafts] = useState<Record<string, OcrDraft>>({});
  const [results, setResults] = useState<Record<string, OcrSaveResult>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const imageQuery = useQuery({
    queryKey: financeKeys.ocrImages(imagePage),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, count, error } = await supabase
        .from("uploaded_transaction_images")
        .select(
          "id,file_name,storage_path,processing_status,error_message,reference_date,analysis_status,analysis_warnings,extracted_count,upload_date",
          { count: "exact" },
        )
        .order("upload_date", { ascending: false })
        .order("id")
        .range(imagePage * 10, imagePage * 10 + 9);
      if (error) throw error;
      return { rows: (data ?? []) as ImageRow[], count: count ?? 0 };
    },
  });
  const reviewQuery = useQuery({
    queryKey: financeKeys.ocrReview(imageId, state, page),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ocr_review", {
        p_image_id: imageId === "all" ? undefined : imageId,
        p_state: state,
        p_page: page,
        p_page_size: PAGE_SIZE,
      });
      if (error) throw error;
      return data as unknown as OcrReview;
    },
  });
  const refresh = () => {
    invalidateFinance(qc, "ocr");
  };
  const chooseImage = (id: string) => {
    setImageId(id);
    setPage(0);
    setSelected(new Set());
  };
  const draftOf = (item: OcrItem) => drafts[item.id] ?? newOcrDraft(item, defaultAccount);
  const matchesOf = (item: OcrItem) => results[item.id]?.matches ?? item.matches;
  const update = (item: OcrItem, change: Partial<OcrDraft>) => {
    setSelected((ids) => {
      const next = new Set(ids);
      next.delete(item.id);
      return next;
    });
    setDrafts((d) => ({
      ...d,
      [item.id]: { ...(d[item.id] ?? newOcrDraft(item, defaultAccount)), ...change },
    }));
    setResults((r) => {
      const next = { ...r };
      delete next[item.id];
      return next;
    });
  };

  const handleFiles = async (files: FileList) => {
    if (!user || !isAdmin || !isValidDateOnly(referenceDate))
      return toast.error("Confira a data de referência");
    const accepted = Array.from(files).filter((file) => {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size === 0 ||
        file.size > 10 * 1024 * 1024
      ) {
        toast.error(`${file.name}: use JPG, PNG ou WebP de até 10 MB`);
        return false;
      }
      return true;
    });
    setUploading(true);
    const process = async (file: File) => {
      try {
        const hash = await sha256Hex(await file.arrayBuffer());
        const { data: existing, error: lookupError } = await supabase
          .from("uploaded_transaction_images")
          .select("id")
          .eq("user_id", user.id)
          .eq("content_hash", hash)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) {
          chooseImage(existing.id);
          setState("all");
          toast.info(`${file.name}: arquivo já recebido. Revisão existente aberta.`);
          return;
        }
        const path = `${user.id}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
        const { error: uploadError } = await supabase.storage
          .from("transaction-prints")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { data: img, error: registerError } = await supabase
          .from("uploaded_transaction_images")
          .insert({
            user_id: user.id,
            file_name: file.name,
            storage_path: path,
            content_hash: hash,
            reference_date: referenceDate,
          })
          .select("id")
          .single();
        if (registerError || !img) {
          await supabase.storage.from("transaction-prints").remove([path]);
          if (registerError?.code === "23505") {
            const { data: repeated, error } = await supabase
              .from("uploaded_transaction_images")
              .select("id")
              .eq("user_id", user.id)
              .eq("content_hash", hash)
              .single();
            if (error) throw error;
            chooseImage(repeated.id);
            setState("all");
            toast.info("Arquivo já registrado por outro envio. Revisão existente aberta.");
            return;
          }
          throw registerError ?? new Error("Falha ao registrar o print");
        }
        chooseImage(img.id);
        setState("pending");
        const result = await extract({ data: { imageId: img.id, referenceDate } });
        if (result.status === "complete")
          toast.success(`${file.name}: ${result.count} lançamentos para conferir`);
        else
          toast.info(
            `${file.name}: ${analysisLabels[result.status] ?? "Revise a leitura"}. Confira os avisos.`,
          );
      } catch (error) {
        toast.error(`${file.name}: ${friendlyError(error, "Falha na importação")}`);
      }
    };
    try {
      const queue = [...accepted];
      await Promise.all(
        Array.from({ length: Math.min(2, queue.length) }, async () => {
          for (let file = queue.shift(); file; file = queue.shift()) await process(file);
        }),
      );
    } finally {
      setUploading(false);
      setImagePage(0);
      refresh();
    }
  };
  const reprocess = async (img: ImageRow) => {
    const date = imageDates[img.id] ?? img.reference_date;
    if (!isValidDateOnly(date)) return toast.error("Informe a data de referência do print");
    setBusy(true);
    try {
      const r = await extract({
        data: { imageId: img.id, referenceDate: date, replacePrevious: true },
      });
      toast.info(`${r.count} itens identificados. Confira a revisão.`);
      chooseImage(img.id);
      setDrafts({});
      setResults({});
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const showImage = async (img: ImageRow) => {
    const { data, error } = await supabase.storage
      .from("transaction-prints")
      .createSignedUrl(img.storage_path, 300);
    if (error) return toast.error(friendlyError(error));
    if (data) setPreview({ id: img.id, url: data.signedUrl });
  };
  const removeImage = async (img: ImageRow) => {
    if (
      !confirm(
        "Excluir este print e sua revisão? As transações já salvas e a memória de importação serão mantidas.",
      )
    )
      return;
    const { error } = await supabase.from("uploaded_transaction_images").delete().eq("id", img.id);
    if (error) return toast.error(friendlyError(error));
    const { error: storageError } = await supabase.storage
      .from("transaction-prints")
      .remove([img.storage_path]);
    if (storageError)
      toast.error("O registro foi removido, mas houve falha ao excluir a imagem armazenada.");
    if (imageId === img.id) chooseImage("all");
    refresh();
  };
  const save = async (
    item: OcrItem,
    allowDuplicate = false,
    existingId?: string,
    recreateDeleted = false,
  ) => {
    const draft = draftOf(item);
    if (!ocrDraftReady(item, draft)) {
      toast.error("Complete os campos e confirme os avisos antes de salvar");
      return false;
    }
    const { data, error } = await supabase.rpc("save_ocr_review", {
      p_detected_id: item.id,
      p_fields: ocrFields(draft),
      p_allow_duplicate: allowDuplicate,
      p_existing_id: existingId,
      p_recreate_deleted: recreateDeleted,
    });
    if (error) {
      toast.error(friendlyError(error));
      return false;
    }
    const result = data as unknown as OcrSaveResult;
    setResults((r) => ({ ...r, [item.id]: result }));
    if (["saved", "linked", "already_imported"].includes(result.status)) {
      toast.success(
        result.status === "saved"
          ? "Transação salva"
          : "Lançamento existente vinculado, sem criar outra transação",
      );
      setSelected((ids) => {
        const next = new Set(ids);
        next.delete(item.id);
        return next;
      });
      invalidateFinance(qc, "transactions", "ocr");
      return true;
    }
    toast.info(
      result.status === "possible_duplicate"
        ? "Há uma possível duplicação. Compare os lançamentos abaixo."
        : "Esta origem já foi importada. Confira o aviso no item.",
    );
    return false;
  };
  const runSave = async (item: OcrItem, allow = false, existing?: string, recreate = false) => {
    setBusy(true);
    try {
      await save(item, allow, existing, recreate);
    } finally {
      setBusy(false);
    }
  };
  const saveSelected = async () => {
    setBusy(true);
    try {
      for (const item of reviewQuery.data?.rows ?? [])
        if (selected.has(item.id) && !matchesOf(item).length && ocrDraftReady(item, draftOf(item)))
          await save(item);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const storeDraft = async (item: OcrItem) => {
    const d = draftOf(item);
    const value = d.amount.trim() ? Number(d.amount) : null;
    if (
      (d.date && !isValidDateOnly(d.date)) ||
      (value !== null &&
        (!Number.isFinite(value) ||
          value <= 0 ||
          Math.abs(value * 100 - Math.round(value * 100)) > 0.00001))
    )
      return toast.error("Corrija data ou valor antes de guardar");
    const { error } = await supabase
      .from("ocr_detected_transactions")
      .update({
        detected_date: d.date || null,
        detected_amount: value,
        detected_type: d.type || null,
        detected_description: d.description || null,
        detected_payment_method: d.payment_method || null,
        suggested_category_id: d.category_id || null,
        review_account_id: d.payment_method === "credito" ? null : d.account_id || null,
        review_card_id: d.payment_method === "credito" ? d.card_id || null : null,
        review_destination_account_id:
          d.type === "transfer" ? d.destination_account_id || null : null,
        external_reference: d.external_reference || null,
        movement_kind: d.movement_kind,
      })
      .eq("id", item.id)
      .in("review_status", ["pending", "needs_review"]);
    if (error) toast.error(friendlyError(error));
    else {
      toast.success("Revisão guardada");
      refresh();
    }
  };
  const ignore = async (item: OcrItem) => {
    const { error } = await supabase
      .from("ocr_detected_transactions")
      .update({ review_status: item.review_status === "ignored" ? "needs_review" : "ignored" })
      .eq("id", item.id)
      .in("review_status", ["pending", "needs_review", "ignored"]);
    if (error) toast.error(friendlyError(error));
    else refresh();
  };
  const error = imageQuery.error ?? reviewQuery.error;
  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">
          Importar por Print
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Envie a imagem, confira os lançamentos e resolva os avisos antes de salvar.
        </p>
      </header>
      {isAdmin && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="max-w-xs">
              <Label htmlFor="capture-date">Data de referência do print</Label>
              <Input
                id="capture-date"
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Usada para Hoje e Ontem. Ajuste ao enviar um print antigo.
              </p>
            </div>
            <label
              className={`flex items-center justify-center gap-3 border-2 border-dashed border-border rounded-lg p-6 cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}
            >
              {uploading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
              <span className="text-sm">
                {uploading ? "Lendo imagens..." : "Selecionar prints, até 10 MB por imagem"}
              </span>
              <input
                className="sr-only"
                aria-label="Selecionar prints"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading || busy}
                onChange={(e) => {
                  if (e.target.files?.length) void handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="p-4">
            <p role="alert">{friendlyError(error, "Não foi possível carregar a revisão")}</p>
            <Button variant="outline" onClick={refresh} className="mt-2">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}
      {imageQuery.isPending && <p>Carregando prints...</p>}
      {!!imageQuery.data?.rows.length && (
        <details open>
          <summary className="cursor-pointer text-sm font-semibold py-2">
            Prints enviados ({imageQuery.data.count})
          </summary>
          <div className="space-y-2">
            {imageQuery.data.rows.map((img) => (
              <Card key={img.id}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-all">{img.file_name}</p>
                      <Badge variant="outline" className="mt-1">
                        {img.processing_status === "failed"
                          ? "Erro na leitura"
                          : img.processing_status === "processing"
                            ? "Em leitura"
                            : (analysisLabels[img.analysis_status] ?? "Pendente")}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => chooseImage(img.id)}>
                        Revisar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Ver ${img.file_name}`}
                        onClick={() => showImage(img)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || uploading}
                            aria-label={`Reler ${img.file_name}`}
                            onClick={() => reprocess(img)}
                          >
                            <ScanLine className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || uploading}
                            aria-label={`Excluir ${img.file_name}`}
                            onClick={() => removeImage(img)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Referência para releitura:</span>
                    <Input
                      type="date"
                      aria-label={`Referência de ${img.file_name}`}
                      value={imageDates[img.id] ?? img.reference_date}
                      disabled={!isAdmin || busy}
                      onChange={(e) => setImageDates((d) => ({ ...d, [img.id]: e.target.value }))}
                      className="w-40 h-8"
                    />
                    <span>{img.extracted_count} itens na última leitura</span>
                  </div>
                  {img.error_message && (
                    <p role="alert" className="text-sm text-destructive">
                      {img.error_message}
                    </p>
                  )}
                  {img.analysis_warnings.map((warning, i) => (
                    <p key={i} className="text-sm text-warning">
                      {warning}
                    </p>
                  ))}
                  {preview?.id === img.id && (
                    <div>
                      <img
                        src={preview.url}
                        alt={`Print original: ${img.file_name}`}
                        className="max-h-[70vh] max-w-full object-contain rounded-md"
                      />
                      <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                        Fechar imagem
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={imagePage === 0 || imageQuery.isFetching}
              onClick={() => setImagePage((p) => p - 1)}
            >
              Prints anteriores
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(imagePage + 1) * 10 >= imageQuery.data.count || imageQuery.isFetching}
              onClick={() => setImagePage((p) => p + 1)}
            >
              Mais prints
            </Button>
          </div>
        </details>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Revisão dos lançamentos</h2>
          {imageId !== "all" && (
            <Button variant="link" className="px-0" onClick={() => chooseImage("all")}>
              Mostrar todos os prints
            </Button>
          )}
        </div>
        <div className="w-full sm:w-52">
          <Label>Situação</Label>
          <Options
            value={state}
            onChange={(value) => {
              setState(value);
              setPage(0);
              setSelected(new Set());
            }}
            options={[
              ["pending", "Aguardando revisão"],
              ["saved", "Já importadas"],
              ["ignored", "Ignoradas"],
              ["all", "Todas"],
            ]}
          />
        </div>
      </div>
      {reviewQuery.data && (
        <p className="text-sm text-muted-foreground">
          {reviewQuery.data.summary.total} itens · {reviewQuery.data.summary.pending} aguardando
          revisão · {reviewQuery.data.summary.incomplete} com avisos ·{" "}
          {reviewQuery.data.summary.saved} já importados
        </p>
      )}
      {isAdmin && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-64">
            <Label>Conta padrão para itens novos</Label>
            <Options
              value={defaultAccount}
              onChange={setDefaultAccount}
              placeholder="Selecione se desejar"
              options={accounts.map((a) => [a.id, a.name])}
            />
          </div>
          <Button
            disabled={busy || !selected.size || reviewQuery.isFetching}
            onClick={saveSelected}
          >
            {busy ? "Processando..." : `Salvar selecionados (${selected.size})`}
          </Button>
        </div>
      )}
      {reviewQuery.isPending && <p>Carregando lançamentos...</p>}
      {reviewQuery.data?.rows.length === 0 && !error && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Nenhum lançamento nesta situação.
          </CardContent>
        </Card>
      )}
      <div className="space-y-4" aria-busy={reviewQuery.isFetching}>
        {reviewQuery.data?.rows.map((item) => {
          const draft = draftOf(item);
          const matches = matchesOf(item);
          const saved = item.review_status === "saved" && !!item.saved_transaction_id;
          const originalRemoved = item.review_status === "saved" && !item.saved_transaction_id;
          const ignored = item.review_status === "ignored";
          const disabled = !isAdmin || busy || saved || ignored;
          const ready = ocrDraftReady(item, draft);
          const incomplete =
            !item.detected_date || item.detected_amount === null || !item.detected_type;
          return (
            <Card key={item.id} className={matches.length ? "border-warning/50" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {originalRemoved
                      ? "Original excluída"
                      : saved
                        ? "Já importada"
                        : ignored
                          ? "Ignorada"
                          : matches.length
                            ? "Possível duplicada"
                            : incomplete
                              ? "Incompleta"
                              : requiresOcrConfirmation(item)
                                ? "Conferir avisos"
                                : "Pronta para revisar"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {item.detected_account || "Conta não identificada no print"}
                  </span>
                  {isAdmin && !saved && !ignored && (
                    <label className="ml-auto flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        disabled={busy || (!selected.has(item.id) && (!ready || !!matches.length))}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((ids) => {
                            const next = new Set(ids);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                      Selecionar
                    </label>
                  )}
                </div>
                {item.raw_text && (
                  <blockquote className="text-xs whitespace-pre-wrap break-words bg-secondary/40 rounded-md p-3">
                    <span className="block text-muted-foreground mb-1">Texto lido no print</span>
                    {item.raw_text}
                  </blockquote>
                )}
                {!saved && item.issues.length > 0 && (
                  <ul className="text-xs text-warning space-y-1">
                    {item.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Field label="Data">
                    <Input
                      aria-label="Data do lançamento"
                      type="date"
                      value={draft.date}
                      disabled={disabled}
                      onChange={(e) => update(item, { date: e.target.value })}
                    />
                  </Field>
                  <Field label="Valor (R$)">
                    <Input
                      aria-label="Valor do lançamento"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draft.amount}
                      disabled={disabled}
                      onChange={(e) => update(item, { amount: e.target.value })}
                    />
                  </Field>
                  <Field label="Tipo">
                    <Options
                      value={draft.type}
                      disabled={disabled}
                      onChange={(value) =>
                        update(item, {
                          type: value,
                          category_id: "",
                          payment_method:
                            value === "transfer" ? "transferencia" : draft.payment_method,
                        })
                      }
                      options={[
                        ["income", "Entrada"],
                        ["expense", "Saída"],
                        ["transfer", "Entre minhas contas"],
                      ]}
                    />
                  </Field>
                  <Field label="Pagamento">
                    <Options
                      value={draft.payment_method}
                      disabled={disabled || draft.type === "transfer"}
                      onChange={(value) => update(item, { payment_method: value })}
                      options={PAYMENT_METHODS.map((p) => [p.value, p.label])}
                    />
                  </Field>
                  <div className="lg:col-span-2">
                    <Field label="Descrição">
                      <Input
                        aria-label="Descrição do lançamento"
                        maxLength={300}
                        value={draft.description}
                        disabled={disabled}
                        onChange={(e) => update(item, { description: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field
                    label={
                      draft.payment_method === "credito"
                        ? "Cartão"
                        : "Conta de origem / recebimento"
                    }
                  >
                    <Options
                      value={draft.payment_method === "credito" ? draft.card_id : draft.account_id}
                      disabled={disabled}
                      onChange={(value) =>
                        update(
                          item,
                          draft.payment_method === "credito"
                            ? { card_id: value }
                            : { account_id: value },
                        )
                      }
                      options={(draft.payment_method === "credito" ? cards : accounts).map((a) => [
                        a.id,
                        a.name,
                      ])}
                    />
                  </Field>
                  {draft.type === "transfer" ? (
                    <Field label="Conta de destino">
                      <Options
                        value={draft.destination_account_id}
                        disabled={disabled}
                        onChange={(value) => update(item, { destination_account_id: value })}
                        options={accounts
                          .filter((a) => a.id !== draft.account_id)
                          .map((a) => [a.id, a.name])}
                      />
                    </Field>
                  ) : (
                    <Field label="Categoria">
                      <Options
                        value={draft.category_id}
                        disabled={disabled}
                        onChange={(value) => update(item, { category_id: value })}
                        options={categories
                          .filter((c) => c.type === draft.type)
                          .map((c) => [c.id, c.name])}
                      />
                    </Field>
                  )}
                </div>
                {!saved && !ignored && (
                  <details>
                    <summary className="cursor-pointer text-sm py-1">
                      Natureza e identificador bancário
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
                      <Field label="Natureza da movimentação">
                        <Options
                          value={draft.movement_kind}
                          disabled={disabled}
                          onChange={(value) => update(item, { movement_kind: value })}
                          options={[
                            ["payment", "Pagamento / compra"],
                            ["income", "Recebimento"],
                            ["own_transfer", "Transferência própria"],
                            ["refund", "Estorno"],
                            ["bill_payment", "Pagamento de fatura"],
                            ["unknown", "Não identificada"],
                          ]}
                        />
                      </Field>
                      <Field label="Identificador bancário completo">
                        <Input
                          maxLength={160}
                          value={draft.external_reference}
                          disabled={disabled}
                          onChange={(e) =>
                            update(item, {
                              external_reference: e.target.value,
                              reference_verified: false,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={draft.reference_verified}
                        disabled={disabled || draft.external_reference.trim().length < 12}
                        onChange={(e) => update(item, { reference_verified: e.target.checked })}
                      />
                      Conferi o identificador completo do evento no banco.
                    </label>
                  </details>
                )}
                {draft.movement_kind === "bill_payment" && !saved && (
                  <p className="text-sm text-warning">
                    Confira o pagamento em{" "}
                    <Link to="/cards" className="underline">
                      Cartões
                    </Link>{" "}
                    e vincule o lançamento existente abaixo para evitar uma segunda despesa.
                  </p>
                )}
                {!saved && !ignored && requiresOcrConfirmation(item) && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      disabled={disabled}
                      checked={draft.confirmed}
                      onChange={(e) => update(item, { confirmed: e.target.checked })}
                    />
                    Conferi os campos, os avisos e a efetivação desta movimentação.
                  </label>
                )}
                {!saved && matches.length > 0 && (
                  <div className="rounded-md border border-warning/40 p-3 space-y-2">
                    <p className="font-medium text-sm">Compare com os registros encontrados</p>
                    {matches.map((match) => (
                      <div
                        key={`${match.source}:${match.id}`}
                        className="rounded bg-secondary/40 p-3 text-sm space-y-1"
                      >
                        <p className="break-words">
                          {match.description || "Sem descrição"} · {formatCurrency(match.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateOnlyPtBR(match.date)} · {match.account} ·{" "}
                          {match.source === "transaction" ? "Já salvo" : "Ainda em revisão"}
                        </p>
                        {isAdmin && match.source === "transaction" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled || !ready}
                            onClick={() => runSave(item, false, match.id)}
                          >
                            Usar este lançamento existente
                          </Button>
                        )}
                        {match.source === "review" && match.image_id && (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => chooseImage(match.image_id!)}
                          >
                            Abrir print do item pendente
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {results[item.id]?.status === "reference_conflict" && (
                  <p role="alert" className="text-sm text-destructive">
                    Este identificador bancário já existe com data, valor ou tipo diferente. Confira
                    o identificador e os campos antes de continuar.
                  </p>
                )}
                {results[item.id]?.status === "deleted_original" && (
                  <div className="text-sm text-warning">
                    <p>
                      A transação desta importação foi excluída. Recriá-la adicionará o valor
                      novamente.
                    </p>
                    <Button
                      variant="outline"
                      disabled={disabled || !ready}
                      onClick={() => {
                        if (confirm("Recriar a transação que foi excluída?"))
                          void runSave(item, false, undefined, true);
                      }}
                    >
                      Confirmar recriação
                    </Button>
                  </div>
                )}
                {saved && (
                  <p className="text-sm text-success">
                    {item.saved_transaction_id
                      ? "Vinculada ao histórico, sem nova gravação."
                      : "A transação original foi excluída. A memória de importação permanece."}{" "}
                    <Link to="/transactions" className="underline">
                      Abrir transações
                    </Link>
                  </p>
                )}
                {isAdmin && !saved && (
                  <div className="flex flex-wrap gap-2">
                    {!ignored && (
                      <>
                        <Button disabled={disabled || !ready} onClick={() => runSave(item)}>
                          {matches.length
                            ? "Rever duplicação antes de salvar"
                            : "Salvar lançamento"}
                        </Button>
                        {matches.length > 0 && (
                          <Button
                            variant="outline"
                            disabled={disabled || !ready}
                            onClick={() => {
                              if (
                                confirm(
                                  "Confirma que esta é outra movimentação, diferente das exibidas?",
                                )
                              )
                                void runSave(item, true);
                            }}
                          >
                            É outra movimentação
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={disabled}
                          onClick={() => storeDraft(item)}
                        >
                          Guardar revisão
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" disabled={busy} onClick={() => ignore(item)}>
                      {ignored ? "Reabrir revisão" : "Ignorar"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {reviewQuery.data && (
        <div className="flex flex-wrap justify-between items-center gap-2 text-sm">
          <span>
            {reviewQuery.data.count} itens no filtro · Página {page + 1}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 0 || reviewQuery.isFetching || busy}
              onClick={() => {
                setPage((p) => p - 1);
                setSelected(new Set());
              }}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={
                (page + 1) * PAGE_SIZE >= reviewQuery.data.count || reviewQuery.isFetching || busy
              }
              onClick={() => {
                setPage((p) => p + 1);
                setSelected(new Set());
              }}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Options({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Confirme",
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[][];
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem value={id} key={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
