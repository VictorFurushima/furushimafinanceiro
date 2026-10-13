// Dados sinteticos parecidos com o uso real (sem dados pessoais): contas, cartao com fechamento 20 e
// vencimento 30, compras parceladas, fatura paga, assinaturas, recarga recorrente, meta, orcamento,
// investimento manual e um print com itens pendentes de revisao (normal, duplicado, sem data, aviso).
import { createHash } from "node:crypto";

export const OWNER = {
  id: "00000000-0000-4000-8000-0000000000e1",
  email: "dono@teste.local",
  password: "Teste#2026",
};
export const VIEWER = {
  id: "00000000-0000-4000-8000-0000000000e2",
  email: "espectador@teste.local",
  password: "Teste#2026",
};
export const GUEST = {
  id: "00000000-0000-4000-8000-0000000000e3",
  email: "convidado@teste.local",
  password: "Teste#2026",
};
// PNG 1x1 valido: o importador valida assinatura do arquivo antes de chamar a IA.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export async function seed(api) {
  const { db } = api;
  api.addUser(OWNER);
  api.addUser(VIEWER);
  api.addUser(GUEST);
  await db.exec(`
    INSERT INTO auth.users(id,email) VALUES ('${OWNER.id}','${OWNER.email}'),('${VIEWER.id}','${VIEWER.email}'),('${GUEST.id}','${GUEST.email}');
    INSERT INTO profiles(id,full_name,email) VALUES ('${OWNER.id}','Titular Teste','${OWNER.email}'),('${VIEWER.id}','Espectador Teste','${VIEWER.email}'),('${GUEST.id}','Convidado Teste','${GUEST.email}');
    INSERT INTO user_roles(user_id,role,owner_id) VALUES ('${OWNER.id}','admin',null),('${VIEWER.id}','viewer','${OWNER.id}'),('${GUEST.id}','admin',null);
  `);
  const sp = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
  await api.asUser(OWNER.id, async (tx) => {
    const one = async (sql, args = []) =>
      Object.values((await tx.query(sql, args)).rows[0] ?? {})[0];
    for (const [name, type, color] of [
      ["Salário", "income", "#10b981"],
      ["Freelance", "income", "#22d3ee"],
      ["Alimentação", "expense", "#f97316"],
      ["Transporte", "expense", "#eab308"],
      ["Saúde", "expense", "#06b6d4"],
      ["Compras", "expense", "#8b5cf6"],
      ["Lazer", "expense", "#ec4899"],
    ])
      await tx.query("INSERT INTO categories(user_id,name,type,color) VALUES ($1,$2,$3,$4)", [
        OWNER.id,
        name,
        type,
        color,
      ]);
    const cat = (name) => one("SELECT id FROM categories WHERE name=$1", [name]);
    const bank = await one(
      "INSERT INTO accounts(user_id,name,type,initial_balance,color) VALUES ($1,'Banco digital','digital_bank',2500,'#4f46e5') RETURNING id",
      [OWNER.id],
    );
    await tx.query(
      "INSERT INTO accounts(user_id,name,type,initial_balance,color) VALUES ($1,'Dinheiro físico','cash',150,'#10b981')",
      [OWNER.id],
    );
    const card = await one(
      "INSERT INTO credit_cards(user_id,name,bank,total_limit,closing_day,due_day,color) VALUES ($1,'Cartão Principal','Banco digital',5000,20,30,'#22d3ee') RETURNING id",
      [OWNER.id],
    );
    await tx.query("UPDATE profiles SET primary_card_id=$1 WHERE id=$2", [card, OWNER.id]);
    const tx1 = (fields) => {
      const cols = Object.keys(fields);
      return one(
        `INSERT INTO transactions(user_id,${cols.join(",")}) VALUES ($1,${cols.map((_, i) => `$${i + 2}`).join(",")}) RETURNING id`,
        [OWNER.id, ...Object.values(fields)],
      );
    };
    // Receita, despesas a vista e compras no cartao (uma parcelada em 3x, iniciada ha dois meses).
    await tx1({
      type: "income",
      amount: 2750,
      description: "Salário setembro",
      occurred_at: await one(`SELECT (${sp}-20)::text`),
      account_id: bank,
      category_id: await cat("Salário"),
      payment_method: "pix",
    });
    await tx1({
      type: "expense",
      amount: 89.9,
      description: "Supermercado",
      occurred_at: await one(`SELECT (${sp}-1)::text`),
      account_id: bank,
      category_id: await cat("Alimentação"),
      payment_method: "pix",
    });
    await tx1({
      type: "expense",
      amount: 337.98,
      description: "Notebook",
      occurred_at: await one(
        `SELECT (date_trunc('month',${sp})-interval '2 months'+interval '5 days')::date::text`,
      ),
      credit_card_id: card,
      installment_count: 3,
      category_id: await cat("Compras"),
    });
    await tx1({
      type: "expense",
      amount: 32.5,
      description: "Farmácia Vida",
      occurred_at: await one(`SELECT (${sp}-3)::text`),
      credit_card_id: card,
      category_id: await cat("Saúde"),
    });
    // Fatura mais antiga paga com a conta do banco.
    const oldest = await one(
      "SELECT id FROM credit_card_bills WHERE card_id=$1 ORDER BY due_date LIMIT 1",
      [card],
    );
    await tx.query("SELECT pay_credit_card_bill($1,$2)", [oldest, bank]);
    // Assinaturas: uma no cartao e uma cobrada hoje via Pix.
    await tx.query(
      `INSERT INTO recurring_expenses(user_id,name,amount,credit_card_id,payment_method,billing_day,start_date,category_id)
       VALUES ($1,'Streaming',39.9,$2,'credito',5,date_trunc('month',${sp})-interval '6 months',$3)`,
      [OWNER.id, card, await cat("Lazer")],
    );
    await tx.query(
      `INSERT INTO recurring_expenses(user_id,name,amount,account_id,payment_method,billing_day,start_date,category_id)
       VALUES ($1,'Academia',99,$2,'pix',EXTRACT(DAY FROM ${sp})::int,date_trunc('month',${sp})-interval '3 months',$3)`,
      [OWNER.id, bank, await cat("Saúde")],
    );
    // Recarga recorrente (modelo deste mes) e meta com prazo hoje.
    await tx.query(
      `INSERT INTO balance_recharges(user_id,name,recharge_type,expected_amount,expected_date,account_id,payment_method,status,is_recurring,recurring_day)
       VALUES ($1,'Salário','fixed_income',2750,(date_trunc('month',${sp})+interval '19 days')::date,$2,'pix','confirmada',true,20)`,
      [OWNER.id, bank],
    );
    await tx.query(
      `INSERT INTO goals(user_id,name,target_amount,current_amount,deadline,color) VALUES ($1,'Reserva de viagem',3000,1200,${sp},'#22d3ee')`,
      [OWNER.id],
    );
    await tx.query(
      `INSERT INTO budgets(user_id,category_id,amount,month) VALUES ($1,$2,800,date_trunc('month',${sp})::date)`,
      [OWNER.id, await cat("Alimentação")],
    );
    await tx.query(`SELECT save_investment_position(NULL,$1::jsonb,'manual',NULL,NULL)`, [
      JSON.stringify({
        name: "CDB Liquidez",
        inv_type: "cdb",
        institution: "Banco digital",
        invested_amount: 1000,
        current_amount: 1035.5,
        initial_amount: 1000,
        applied_at: "2026-01-10",
        liquidity: "diaria",
        risk: "baixo",
        status: "ativo",
        is_emergency_reserve: true,
        color: "#228E9A",
      }),
    ]);
    // Print ja lido pela IA com itens pendentes de revisao.
    const hash = createHash("sha256").update(PNG).digest("hex");
    const path = `${OWNER.id}/e2e-print.png`;
    api.files.set(`transaction-prints/${path}`, { bytes: PNG, type: "image/png", owner: OWNER.id });
    const image = await one(
      `INSERT INTO uploaded_transaction_images(user_id,file_name,storage_path,content_hash,processing_status,analysis_status,extracted_count,prompt_version,document_type,ocr_confidence,visible_transaction_count)
       VALUES ($1,'fatura-outubro.png',$2,$3,'completed','complete',5,'2026-09-22.v2','card_statement','alta',5) RETURNING id`,
      [OWNER.id, path, hash],
    );
    const item = async (key, date, amount, description, extra = {}) =>
      tx.query(
        `INSERT INTO ocr_detected_transactions(user_id,image_id,source_key,detected_date,detected_amount,detected_type,detected_description,detected_payment_method,detected_account,confidence_level,review_status,movement_kind,transaction_status,issues,raw_text,suggested_category_id)
         VALUES ($1,$2,$3,$4::date,$5,'expense',$6,'credito','Cartão Principal',$7,$8,'payment','completed',$9,$10,$11)`,
        [
          OWNER.id,
          image,
          key,
          date,
          amount,
          description,
          extra.confidence ?? "alta",
          extra.status ?? "pending",
          extra.issues ?? [],
          `${date ?? "sem data"} ${description} R$ ${amount}`,
          extra.category ?? null,
        ],
      );
    await item("e2e-a", await one(`SELECT (${sp}-2)::text`), 45.9, "Mercado Bom Preço", {
      category: await cat("Alimentação"),
    });
    await item("e2e-b", await one(`SELECT (${sp}-1)::text`), 120, "Posto Shell", {
      category: await cat("Transporte"),
    });
    await item("e2e-c", await one(`SELECT (${sp}-3)::text`), 32.5, "Farmácia Vida", {
      category: await cat("Saúde"),
    });
    await item("e2e-d", null, 100, "Compra sem data", {
      status: "needs_review",
      issues: ["date_missing"],
    });
    await item("e2e-e", await one(`SELECT (${sp}-4)::text`), 18.75, "Padaria", {
      confidence: "media",
      status: "needs_review",
      issues: ["amount_uncertain"],
    });
  });
}
