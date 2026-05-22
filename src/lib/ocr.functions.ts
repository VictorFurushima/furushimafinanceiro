import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `Você é um assistente que extrai transações financeiras de prints de extratos bancários, faturas de cartão, históricos de Pix, comprovantes e carteiras digitais brasileiras.

Sua tarefa: identificar TODAS as transações visíveis na imagem e retornar JSON.

Regras:
- Datas no formato YYYY-MM-DD. Se o print mostrar dd/mm, assuma o ano atual.
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

export const extractTransactionsFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      imageId: z.string().uuid(),
      storagePath: z.string().min(1).max(1024),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");

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
    await supabase.from("uploaded_transaction_images")
      .update({ processing_status: "processing" })
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
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Extraia todas as transações visíveis deste print." },
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
      await supabase.from("uploaded_transaction_images")
        .update({
          processing_status: "failed",
          error_message: e instanceof Error ? e.message : String(e),
        })
        .eq("id", data.imageId);
      throw e;
    }

    const txs = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    const overall = parsed.overall_confidence ?? "media";

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
      const fuzzy = cats.find((c) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n));
      if (fuzzy) return fuzzy.id;
      // fallback Outros for the matching type
      const fb = cats.find((c) => c.name.toLowerCase() === "outros" && c.type === (type === "income" ? "income" : "expense"));
      return fb?.id ?? null;
    };

    // Duplicate detection
    const dupOf = async (date: string | null, amount: number | null, desc: string | null) => {
      if (!date || !amount) return false;
      const { data: dups } = await supabase
        .from("transactions")
        .select("id, description")
        .eq("user_id", userId)
        .eq("occurred_at", date)
        .eq("amount", amount)
        .limit(5);
      if (!dups || dups.length === 0) return false;
      if (!desc) return true;
      const d = desc.toLowerCase();
      return dups.some((x) => (x.description ?? "").toLowerCase().includes(d.slice(0, 12)) || d.includes((x.description ?? "").toLowerCase().slice(0, 12)));
    };

    const rows: Array<Record<string, unknown>> = [];
    for (const t of txs) {
      const amt = typeof t.amount === "number" ? Math.abs(t.amount) : null;
      const type = t.type === "income" ? "income" : "expense";
      const dup = await dupOf(t.date ?? null, amt, t.description ?? null);
      const conf = t.confidence ?? overall;
      rows.push({
        user_id: userId,
        image_id: data.imageId,
        detected_date: t.date ?? null,
        detected_amount: amt,
        detected_type: type,
        detected_description: t.description ?? null,
        detected_payment_method: t.payment_method ?? null,
        detected_account: t.account ?? null,
        suggested_category: t.suggested_category ?? null,
        suggested_category_id: matchCategoryId(t.suggested_category, type),
        confidence_level: conf,
        review_status: conf === "baixa" ? "needs_review" : "pending",
        possible_duplicate: dup,
      });
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("ocr_detected_transactions").insert(rows);
      if (insErr) throw insErr;
    }

    await supabase.from("uploaded_transaction_images")
      .update({
        processing_status: "completed",
        ocr_confidence: overall,
      })
      .eq("id", data.imageId);

    return { count: rows.length, confidence: overall };
  });
