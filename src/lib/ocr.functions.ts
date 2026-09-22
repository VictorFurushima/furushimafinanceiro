import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { isValidDateOnly } from "@/lib/date-only";
import { buildOcrPrompt, OCR_PROMPT_VERSION } from "@/lib/ocr-prompt";
import { normalizeOcrResponse, normalizeOcrText, sha256Hex } from "@/lib/ocr-schema";

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v))
    return "image/png";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export const extractTransactionsFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        imageId: z.string().uuid(),
        replacePrevious: z.boolean().optional(),
        referenceDate: z.string().refine(isValidDateOnly, "Data de referência inválida").optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: admin, error: roleError } = await supabase.rpc("is_admin", { _user_id: userId });
    if (roleError || !admin) throw new Error("Somente o administrador pode importar prints");
    const { data: img, error: imgErr } = await supabase
      .from("uploaded_transaction_images")
      .select(
        "id, storage_path, user_id, content_hash, reference_date, extracted_count, analysis_status",
      )
      .eq("id", data.imageId)
      .eq("user_id", userId)
      .single();
    if (imgErr || !img) throw new Error("Imagem não encontrada");
    const referenceDate = data.referenceDate ?? img.reference_date;
    const { data: claimData, error: claimError } = await supabase.rpc("begin_ocr_processing", {
      p_image_id: img.id,
      p_reference_date: referenceDate,
      p_force: !!data.replacePrevious,
    });
    if (claimError) throw claimError;
    const claim = claimData as { status: string; token?: string };
    if (claim.status === "busy")
      throw new Error("Este print já está sendo lido. Aguarde a conclusão e atualize a revisão.");
    if (claim.status === "completed")
      return { count: img.extracted_count, status: img.analysis_status, reused: true };
    if (!claim.token) throw new Error("Não foi possível iniciar a leitura");
    try {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("Serviço de leitura indisponível: chave de IA não configurada");
      const { data: blob, error: downloadError } = await supabase.storage
        .from("transaction-prints")
        .download(img.storage_path);
      if (downloadError || !blob) throw new Error("Falha ao abrir a imagem enviada");
      const bytes = await blob.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024)
        throw new Error("Imagem vazia ou acima de 10 MB");
      const mime = detectImageMime(new Uint8Array(bytes));
      if (!mime) throw new Error("Use uma imagem JPG, PNG ou WebP válida");
      const hash = await sha256Hex(bytes);
      if (img.content_hash && img.content_hash !== hash)
        throw new Error("O arquivo foi alterado. Envie o print novamente");
      if (!img.content_hash) {
        const { error } = await supabase
          .from("uploaded_transaction_images")
          .update({ content_hash: hash })
          .eq("id", img.id);
        if (error)
          throw new Error("Este arquivo já está cadastrado. Abra a revisão do print existente");
      }
      const { data: categories, error: categoriesError } = await supabase
        .from("categories")
        .select("id, name, type")
        .eq("user_id", userId);
      if (categoriesError) throw categoriesError;
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 0,
          max_tokens: 16000,
          messages: [
            {
              role: "system",
              content: buildOcrPrompt(
                referenceDate,
                (categories ?? []).map(({ name, type }) => ({ name, type })),
              ),
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Leia todas as movimentações visíveis, preserve evidências e informe omissões ou campos incompletos no formato definido.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok)
        throw new Error(
          `Serviço de leitura respondeu ${response.status}. Tente novamente mais tarde.`,
        );
      const payload = await response.json();
      if (payload.choices?.[0]?.finish_reason === "length")
        throw new Error(
          "A leitura excedeu o limite. Divida o print em imagens menores. A revisão anterior foi preservada.",
        );
      let normalized;
      try {
        normalized = normalizeOcrResponse(JSON.parse(payload.choices?.[0]?.message?.content ?? ""));
      } catch {
        throw new Error(
          "A IA devolveu dados incompletos ou fora do formato esperado. A revisão anterior foi preservada. Tente uma imagem mais legível.",
        );
      }
      const occurrences = new Map<string, number>();
      const transactions = [];
      for (const item of normalized.transactions) {
        const identity =
          normalizeOcrText(item.raw_text) ||
          JSON.stringify([item.date, item.amount, item.description, item.type]);
        const occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        const source_key = await sha256Hex(
          new TextEncoder().encode(`${identity}|${occurrence}`).buffer as ArrayBuffer,
        );
        const category = categories?.find(
          (c) =>
            c.type === item.type &&
            normalizeOcrText(c.name) === normalizeOcrText(item.suggested_category ?? ""),
        );
        transactions.push({ ...item, source_key, suggested_category_id: category?.id ?? null });
      }
      const { data: count, error: finishError } = await supabase.rpc("finish_ocr_processing", {
        p_image_id: img.id,
        p_token: claim.token,
        p_result: { ...normalized, transactions } as unknown as Json,
        p_prompt_version: OCR_PROMPT_VERSION,
      });
      if (finishError) throw finishError;
      return { count: count ?? 0, status: normalized.analysis_status, reused: false };
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Falha na leitura. A revisão anterior foi preservada.";
      await supabase
        .from("uploaded_transaction_images")
        .update({
          processing_status: "failed",
          error_message: message.slice(0, 500),
          processing_token: null,
        })
        .eq("id", img.id)
        .eq("processing_token", claim.token);
      throw new Error(message);
    }
  });
