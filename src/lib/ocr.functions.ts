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
- Se o print exibir dd/mm sem ano, procure o ano no cabeçalho (período do extrato, mês de referência da fatura, título "Janeiro/2025", etc.) e use esse ano.
- Se o print trouxer um ano explícito, use exatamente esse ano. Nunca substitua pelo ano atual.
- Se, mesmo assim, o ano permanecer ambíguo, ou se o dia/mês forem ambíguos, marque confidence "baixa" e ainda assim devolva a melhor leitura literal. Não invente datas.
- Nunca devolva datas de calendário impossíveis (ex.: 31/02).

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

export const extractTransactionsFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        imageId: z.string().uuid(),
        storagePath: z.string().min(1).max(1024),
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
      .download(data.storagePath);
    if (dlErr || !blob) throw new Error("Falha ao baixar imagem: " + (dlErr?.message ?? ""));

    const arrayBuf = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    const mime = blob.type || "image/jpeg";
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

    const txs = Array.isArray(parsed.transactions) ? parsed.transactions : [];
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
        typeof t.amount === "number" && Number.isFinite(t.amount) ? Math.abs(t.amount) : null;
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
        description: t.description ?? null,
        payment_method: t.payment_method ?? null,
        account: t.account ?? null,
        suggested_category: t.suggested_category ?? null,
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

    // Releitura: só descarta o conjunto anterior AGORA, com a nova leitura pronta.
    if (data.replacePrevious) {
      const { error: delErr } = await supabase
        .from("ocr_detected_transactions")
        .delete()
        .eq("image_id", data.imageId)
        .eq("user_id", userId)
        .in("review_status", ["pending", "needs_review"]);
      if (delErr) throw delErr;
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("ocr_detected_transactions").insert(rows);
      if (insErr) throw insErr;
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
