import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APP_TIMEZONE, isValidDateOnly, todayISO } from "@/lib/date-only";

const buildSystemPrompt = (
  today: string,
) => `Você é um assistente que extrai transações financeiras de prints de extratos bancários, faturas de cartão, históricos de Pix, comprovantes e carteiras digitais brasileiras.

CONTEXTO TEMPORAL (obrigatório):
- Data local de hoje: ${today} (fuso ${APP_TIMEZONE}).
- "Hoje" = ${today}. "Ontem" = o dia anterior a ${today}.
- Se o print trouxer um ano explícito no próprio item, use exatamente esse ano. Nunca substitua pelo ano atual.
- Se o item exibir dd/mm sem ano, use o ano APENAS quando houver cabeçalho/período confiável (período do extrato, mês de referência da fatura, título "Janeiro/2025", etc.).
- Se não houver ano no item nem cabeçalho/período confiável, "date" DEVE ser null e confidence "baixa". NUNCA assuma o ano atual.
- Se dia, mês ou ano forem ambíguos por qualquer motivo, "date" DEVE ser null e confidence "baixa".
- É melhor devolver date null do que uma data inventada; o usuário preenche manualmente na revisão.
- Nunca devolva datas de calendário impossíveis (ex.: 31/02); nesse caso devolva null.

Sua tarefa: identificar TODAS as transações visíveis na imagem e retornar JSON.

Regras:
- Datas no formato YYYY-MM-DD.
- Valores como número decimal positivo (sem R$, sem milhar). Ex: 1234.56
- type: "income" para entradas/recebimentos/créditos, "expense" para saídas/pagamentos/débitos
- payment_method: um de [pix, debito, credito, dinheiro, boleto, transferencia] ou null
- description: nome do estabelecimento, destinatário ou descrição curta
- account: nome do banco/cartão se visível, senão null
- confidence: "alta" | "media" | "baixa" por transação
- suggested_category: sugira UMA categoria em português entre: Alimentação, Transporte, Mercado, Saúde, Lazer, Compras, Assinaturas, Moradia, Academia, Jogos, Salário, Freelance, Investimentos, Outros
- Se a imagem não contiver transações financeiras claras, retorne lista vazia.
- Se algum campo não estiver visível, use null.

Sugestões de categoria:
- iFood, McDonald's, Burger King, restaurante, lanchonete → Alimentação
- Uber, 99, posto, combustível → Transporte
- Spotify, Netflix, ChatGPT, Disney → Assinaturas
- Steam, PlayStation, Xbox → Jogos
- Farmácia, Drogaria, hospital → Saúde
- Smart Fit, academia → Academia
- Mercado, Atacadão, Carrefour, Pão de Açúcar → Mercado
- Amazon, Mercado Livre, Shopee, Magalu → Compras
- Salário, Pagamento, Mesada → Salário

Retorne APENAS JSON válido no formato:
{ "overall_confidence": "alta|media|baixa", "transactions": [ { "date": "...", "amount": 0, "type": "...", "description": "...", "payment_method": "...", "account": "...", "suggested_category": "...", "confidence": "..." } ] }`;

/** Normaliza descrição para comparação de duplicidade. */
const normalizeDesc = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const CONFIDENCES = new Set(["alta", "media", "baixa"]);
const PAYMENT_METHODS = new Set([
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "boleto",
  "transferencia",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DETECTED_TRANSACTIONS = 500;

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const limitedText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) || null : null;

export const extractTransactionsFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        imageId: z.string().uuid(),
        /** true quando é releitura: só apaga o conjunto anterior após sucesso. */
        replacePrevious: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");

    const today = todayISO();

    // Verify image belongs to the user
    const { data: img, error: imgErr } = await supabase
      .from("uploaded_transaction_images")
      .select("id, storage_path, user_id")
      .eq("id", data.imageId)
      .single();
    if (imgErr || !img || img.user_id !== userId) {
      throw new Error("Imagem não encontrada");
    }

    // Download image via authenticated client (RLS)
    const { data: blob, error: dlErr } = await supabase.storage
      .from("transaction-prints")
      .download(img.storage_path);
    if (dlErr || !blob) throw new Error("Falha ao baixar imagem: " + (dlErr?.message ?? ""));

    const arrayBuf = await blob.arrayBuffer();
    if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_IMAGE_BYTES) {
      await supabase
        .from("uploaded_transaction_images")
        .update({ processing_status: "failed", error_message: "Imagem vazia ou acima de 10 MB" })
        .eq("id", data.imageId);
      throw new Error("Imagem vazia ou acima de 10 MB");
    }
    const mime = detectImageMime(new Uint8Array(arrayBuf));
    if (!mime) {
      await supabase
        .from("uploaded_transaction_images")
        .update({
          processing_status: "failed",
          error_message: "Arquivo nao e uma imagem JPG, PNG ou WebP valida",
        })
        .eq("id", data.imageId);
      throw new Error("Arquivo não é uma imagem JPG, PNG ou WebP válida");
    }
    const base64 = Buffer.from(arrayBuf).toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

    // Mark as processing
    await supabase
      .from("uploaded_transaction_images")
      .update({ processing_status: "processing", error_message: null })
      .eq("id", data.imageId);

    let parsed: {
      overall_confidence?: string;
      transactions?: Array<{
        date?: string | null;
        amount?: number | null;
        type?: string | null;
        description?: string | null;
        payment_method?: string | null;
        account?: string | null;
        suggested_category?: string | null;
        confidence?: string | null;
      }>;
    } = {};

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: buildSystemPrompt(today) },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extraia todas as transações visíveis deste print. Hoje é ${today} (${APP_TIMEZONE}).`,
                },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`AI Gateway ${res.status}: ${txt.slice(0, 300)}`);
      }
      const j = await res.json();
      const content: string = j.choices?.[0]?.message?.content ?? "{}";
      parsed = JSON.parse(content);
    } catch (e) {
      await supabase
        .from("uploaded_transaction_images")
        .update({
          processing_status: "failed",
          error_message: e instanceof Error ? e.message : String(e),
        })
        .eq("id", data.imageId);
      throw e;
    }

    const txs = Array.isArray(parsed.transactions)
      ? parsed.transactions.slice(0, MAX_DETECTED_TRANSACTIONS)
      : [];
    const overallRaw = parsed.overall_confidence ?? "media";
    const overall = CONFIDENCES.has(overallRaw) ? overallRaw : "media";

    // Load user categories for suggested_category_id matching
    const { data: cats } = await supabase
      .from("categories")
      .select("id, name, type")
      .eq("user_id", userId);

    const matchCategoryId = (name: string | null | undefined, type: string | null | undefined) => {
      if (!name || !cats) return null;
      const n = name.toLowerCase().trim();
      const exact = cats.find((c) => c.name.toLowerCase() === n);
      if (exact) return exact.id;
      const fuzzy = cats.find(
        (c) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n),
      );
      if (fuzzy) return fuzzy.id;
      // fallback Outros for the matching type
      const fb = cats.find(
        (c) =>
          c.name.toLowerCase() === "outros" &&
          c.type === (type === "income" ? "income" : "expense"),
      );
      return fb?.id ?? null;
    };

    // --- Normalização e validação determinística de cada linha ---
    type Candidate = {
      date: string | null;
      amount: number | null;
      type: "income" | "expense";
      description: string | null;
      payment_method: string | null;
      account: string | null;
      suggested_category: string | null;
      confidence: string;
    };

    const candidates: Candidate[] = txs.map((t) => {
      const amt =
        typeof t.amount === "number" && Number.isFinite(t.amount) && t.amount !== 0
          ? Math.abs(t.amount)
          : null;
      const type: "income" | "expense" = t.type === "income" ? "income" : "expense";
      const rawDate = typeof t.date === "string" ? t.date.trim().slice(0, 10) : null;
      const dateOk = rawDate !== null && isValidDateOnly(rawDate);
      let confidence = CONFIDENCES.has(t.confidence ?? "") ? (t.confidence as string) : overall;
      // Data inválida/ausente ou valor ausente → revisão manual obrigatória.
      if (!dateOk || amt === null) confidence = "baixa";
      return {
        date: dateOk ? rawDate : null,
        amount: amt,
        type,
        description: limitedText(t.description, 300),
        payment_method: PAYMENT_METHODS.has(t.payment_method ?? "") ? t.payment_method! : null,
        account: limitedText(t.account, 120),
        suggested_category: limitedText(t.suggested_category, 120),
        confidence,
      };
    });

    // --- Detecção de duplicidade em LOTE (sem N+1) ---
    const dates = [...new Set(candidates.map((c) => c.date).filter((d): d is string => !!d))];
    let existing: { occurred_at: string; amount: number; description: string | null }[] = [];
    if (dates.length > 0) {
      const { data: rows } = await supabase
        .from("transactions")
        .select("occurred_at, amount, description")
        .eq("user_id", userId)
        .in("occurred_at", dates);
      existing = (rows ?? []).map((r) => ({
        occurred_at: r.occurred_at,
        amount: Number(r.amount),
        description: r.description,
      }));
    }

    const isDuplicate = (c: Candidate) => {
      if (!c.date || c.amount === null) return false;
      const target = normalizeDesc(c.description);
      return existing.some((e) => {
        if (e.occurred_at !== c.date) return false;
        if (Math.abs(e.amount - c.amount!) > 0.005) return false;
        if (!target) return true;
        const other = normalizeDesc(e.description);
        if (!other) return true;
        return other.includes(target.slice(0, 12)) || target.includes(other.slice(0, 12));
      });
    };

    const rows = candidates.map((c) => ({
      user_id: userId,
      image_id: data.imageId,
      detected_date: c.date,
      detected_amount: c.amount,
      detected_type: c.type,
      detected_description: c.description,
      detected_payment_method: c.payment_method,
      detected_account: c.account,
      suggested_category: c.suggested_category,
      suggested_category_id: matchCategoryId(c.suggested_category, c.type),
      confidence_level: c.confidence,
      review_status: c.confidence === "baixa" ? "needs_review" : "pending",
      possible_duplicate: isDuplicate(c),
    }));

    /** Marca a imagem como falha sem destruir nenhum dado já existente. */
    const markFailed = async (message: string) => {
      await supabase
        .from("uploaded_transaction_images")
        .update({ processing_status: "failed", error_message: message.slice(0, 500) })
        .eq("id", data.imageId);
    };

    // IDs antigos elegíveis à troca (nunca saved/ignored).
    let previousIds: string[] = [];
    if (data.replacePrevious) {
      const { data: prev, error: prevErr } = await supabase
        .from("ocr_detected_transactions")
        .select("id")
        .eq("image_id", data.imageId)
        .eq("user_id", userId)
        .in("review_status", ["pending", "needs_review"]);
      if (prevErr) {
        await markFailed(prevErr.message);
        throw prevErr;
      }
      previousIds = (prev ?? []).map((p) => p.id);
    }

    // Releitura vazia com conjunto anterior existente = falha de releitura: preserva o anterior.
    if (data.replacePrevious && previousIds.length > 0 && rows.length === 0) {
      const msg =
        "Releitura não encontrou nenhuma transação; o conjunto anterior foi preservado. Tente novamente com uma imagem mais legível.";
      await markFailed(msg);
      throw new Error(msg);
    }

    // 1) Insere o novo conjunto e captura os IDs criados.
    let insertedIds: string[] = [];
    if (rows.length > 0) {
      const { data: ins, error: insErr } = await supabase
        .from("ocr_detected_transactions")
        .insert(rows)
        .select("id");
      if (insErr) {
        await markFailed(insErr.message);
        throw insErr;
      }
      insertedIds = (ins ?? []).map((r) => r.id);
    }

    // 2) Só agora remove exatamente os IDs antigos capturados.
    if (previousIds.length > 0) {
      const { error: delErr } = await supabase
        .from("ocr_detected_transactions")
        .delete()
        .eq("user_id", userId)
        .in("id", previousIds);
      if (delErr) {
        // Compensação: desfaz a inserção nova, preservando o conjunto anterior íntegro.
        if (insertedIds.length > 0) {
          await supabase
            .from("ocr_detected_transactions")
            .delete()
            .eq("user_id", userId)
            .in("id", insertedIds);
        }
        await markFailed(delErr.message);
        throw delErr;
      }
    }

    const finalConfidence = rows.some((r) => r.confidence_level === "baixa") ? "baixa" : overall;

    await supabase
      .from("uploaded_transaction_images")
      .update({
        processing_status: "completed",
        ocr_confidence: finalConfidence,
        error_message: null,
      })
      .eq("id", data.imageId);

    return { count: rows.length, confidence: finalConfidence };
  });
