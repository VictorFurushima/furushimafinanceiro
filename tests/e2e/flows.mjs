// Fluxos de uso real conduzidos pelo navegador. Cada cenario confere a tela e o banco.
export async function run(ctx) {
  const {
    page,
    api,
    scenario,
    shot,
    toast,
    APP,
    OWNER,
    VIEWER,
    GUEST,
    PNG,
    assert,
    hydrated,
    login,
  } = ctx;
  const q = async (sql, args = []) => (await api.db.query(sql, args)).rows;
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0] ?? {})[0];
  const go = async (route) => {
    await page.goto(`${APP}${route}`, { timeout: 120_000 });
    await hydrated();
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  };
  // Toasts de cenarios anteriores podem continuar visiveis: conferencias de banco esperam o valor.
  const eventually = async (sql, expected, message, args = []) => {
    const deadline = Date.now() + 15_000;
    let last;
    while (Date.now() < deadline) {
      last = await one(sql, args);
      if (String(last) === String(expected)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(String(last), String(expected), message);
  };
  const today = await one("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text");
  // Cartao de revisao do OCR: o menor bloco bg-card que contem o texto lido e as acoes.
  const ocrCard = (text) =>
    page
      .locator("div.bg-card")
      .filter({ hasText: text })
      .filter({ has: page.getByRole("button", { name: "Ignorar" }) })
      .last();

  await scenario("print: resumo e itens pendentes carregam", async () => {
    await go("/import-prints");
    await page.getByText(/5 itens · 5 aguardando revisão/).waitFor({ timeout: 30_000 });
    for (const text of [
      "Mercado Bom Preço",
      "Posto Shell",
      "Farmácia Vida",
      "Compra sem data",
      "Padaria",
    ])
      await ocrCard(text).waitFor({ timeout: 20_000 });
    await ocrCard("Farmácia Vida").getByText("Possível duplicada").waitFor();
    await shot("print-revisao-inicial");
  });

  await scenario("print: salvar item pronto cria compra no cartão", async () => {
    const card = ocrCard("Mercado Bom Preço");
    await card.getByRole("button", { name: "Salvar lançamento" }).click();
    await toast(/Transação salva/);
    await eventually(
      "SELECT count(*) FROM transactions WHERE description='Mercado Bom Preço' AND credit_card_id IS NOT NULL",
      1,
    );
  });

  await scenario("print: duplicata vincula o lançamento existente sem duplicar", async () => {
    const card = ocrCard("Farmácia Vida");
    await card.getByRole("button", { name: "Usar este lançamento existente" }).click();
    await toast(/Lançamento existente vinculado/);
    assert.equal(
      Number(await one("SELECT count(*) FROM transactions WHERE description='Farmácia Vida'")),
      1,
    );
    assert.equal(
      await one("SELECT review_status FROM ocr_detected_transactions WHERE source_key='e2e-c'"),
      "saved",
    );
  });

  await scenario("print: item com aviso exige confirmação e salva", async () => {
    const card = ocrCard("Padaria");
    const save = card.getByRole("button", { name: "Salvar lançamento" });
    assert.equal(await save.isDisabled(), true, "salvar deveria exigir confirmação");
    await card.getByText("Conferi os campos, os avisos e a efetivação desta movimentação.").click();
    await save.click();
    await toast(/Transação salva/);
  });

  await scenario("print: item sem data é completado e salvo", async () => {
    const card = ocrCard("Compra sem data");
    await card.getByLabel("Data do lançamento").fill(today);
    await card.getByText("Conferi os campos, os avisos e a efetivação desta movimentação.").click();
    await card.getByRole("button", { name: "Salvar lançamento" }).click();
    await toast(/Transação salva/);
    await eventually(
      "SELECT occurred_at::text FROM transactions WHERE description='Compra sem data'",
      today,
    );
  });

  await scenario("print: salvar selecionados em lote", async () => {
    const card = ocrCard("Posto Shell");
    await card.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Salvar selecionados \(1\)/ }).click();
    await toast(/Transação salva/);
    await page
      .getByText(/aguardando revisão/)
      .first()
      .waitFor();
    await eventually(
      "SELECT count(*) FROM ocr_detected_transactions WHERE review_status='saved'",
      5,
    );
    await shot("print-revisao-concluida");
  });

  await scenario("print: compras salvas entram na fatura e no limite do cartão", async () => {
    const used = Number(
      await one("SELECT used_limit FROM credit_cards WHERE name='Cartão Principal'"),
    );
    const open = Number(
      await one("SELECT coalesce(sum(amount),0) FROM credit_card_bills WHERE status<>'paga'"),
    );
    assert.equal(used, open, "limite usado = faturas em aberto");
    assert.equal(
      Number(await one("SELECT count(*) FROM ocr_import_receipts")),
      5,
      "um recibo durável por item",
    );
  });

  await scenario(
    "print: envio de novo print guarda a imagem e reporta falha da leitura",
    async () => {
      const before = Number(await one("SELECT count(*) FROM uploaded_transaction_images"));
      const fresh = Buffer.concat([PNG, Buffer.from(`e2e-${Date.now()}`)]);
      await page.locator('input[type="file"][accept*="image"]').setInputFiles({
        name: "novo-print.png",
        mimeType: "image/png",
        buffer: fresh,
      });
      // Localmente nao ha chave da IA: a leitura deve falhar de forma explicita, sem perder dados.
      await page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /chave de IA|Serviço de leitura|novo-print/ })
        .first()
        .waitFor({ timeout: 60_000 });
      assert.equal(
        Number(await one("SELECT count(*) FROM uploaded_transaction_images")),
        before + 1,
      );
      const failed = await q(
        "SELECT processing_status, error_message FROM uploaded_transaction_images WHERE file_name='novo-print.png'",
      );
      assert.equal(failed[0]?.processing_status, "failed", JSON.stringify(failed));
      assert.ok(
        api.files.has(
          `transaction-prints/${OWNER.id}/${await one("SELECT split_part(storage_path,'/',2) FROM uploaded_transaction_images WHERE file_name='novo-print.png'")}`,
        ),
      );
      assert.equal(
        Number(
          await one("SELECT count(*) FROM ocr_detected_transactions WHERE review_status='saved'"),
        ),
        5,
        "revisões anteriores preservadas",
      );
      await shot("print-novo-envio");
    },
  );

  const dialog = () => page.getByRole("dialog");
  // Radix Select: abre o gatilho do campo e escolhe a opcao pelo nome.
  const choose = async (trigger, option) => {
    await trigger.click();
    await page.getByRole("option", { name: option }).first().click();
  };
  const bank = await one("SELECT id FROM accounts WHERE name='Banco digital'");
  const brToday = today.split("-").reverse().join("/");

  await scenario(
    "transações: nova despesa no Pix entra na lista e no saldo e pode ser excluída",
    async () => {
      await go("/transactions");
      await page.getByRole("button", { name: "Nova", exact: true }).click();
      await dialog().getByPlaceholder("0,00").fill("57,30");
      await dialog()
        .getByPlaceholder(/Almoço/)
        .fill("Restaurante E2E");
      await dialog().getByRole("button", { name: "Adicionar" }).click();
      await toast(/Transação adicionada/);
      await page.getByText("Restaurante E2E").first().waitFor();
      const row = await q(
        "SELECT account_id, amount, payment_method FROM transactions WHERE description='Restaurante E2E'",
      );
      assert.equal(row.length, 1);
      assert.equal(row[0].account_id, bank);
      assert.equal(Number(row[0].amount), 57.3);
      await page
        .locator("li")
        .filter({ hasText: "Restaurante E2E" })
        .getByRole("button", { name: "Excluir transação" })
        .click();
      await toast(/Excluída/);
      assert.equal(
        Number(await one("SELECT count(*) FROM transactions WHERE description='Restaurante E2E'")),
        0,
      );
    },
  );

  await scenario("parcelas: compra parcelada em 3x gera parcelas e aparece na lista", async () => {
    await go("/installments");
    await page.getByRole("button", { name: "Nova compra parcelada" }).click();
    await dialog().getByPlaceholder("0,00").fill("600");
    await dialog()
      .getByPlaceholder(/Almoço/)
      .fill("Celular E2E");
    await dialog().locator('input[type="number"]').fill("3");
    await dialog().getByRole("button", { name: "Adicionar" }).click();
    await toast(/Transação adicionada/);
    await page.getByText("Celular E2E").first().waitFor({ timeout: 20_000 });
    assert.equal(
      Number(
        await one(
          "SELECT count(*) FROM credit_card_bill_items i JOIN transactions t ON t.id=i.transaction_id WHERE t.description='Celular E2E'",
        ),
      ),
      3,
    );
    await shot("parcelas");
  });

  await scenario("cartões: pagar fatura debita a conta e libera o limite", async () => {
    await go("/cards");
    const payments = Number(
      await one("SELECT count(*) FROM transactions WHERE flow='bill_payment'"),
    );
    await page.getByRole("button", { name: "Pagar" }).first().click();
    await toast(/Fatura paga/);
    assert.equal(
      Number(await one("SELECT count(*) FROM transactions WHERE flow='bill_payment'")),
      payments + 1,
    );
    assert.equal(
      await one("SELECT max(occurred_at)::text FROM transactions WHERE flow='bill_payment'"),
      today,
      "pagamento datado no dia de Sao Paulo",
    );
    const used = Number(
      await one("SELECT used_limit FROM credit_cards WHERE name='Cartão Principal'"),
    );
    const open = Number(
      await one("SELECT coalesce(sum(amount),0) FROM credit_card_bills WHERE status<>'paga'"),
    );
    assert.equal(used, open);
    await shot("cartoes");
  });

  await scenario(
    "assinaturas: cobrança de hoje aparece como hoje e nova assinatura é criada",
    async () => {
      await go("/recurring");
      await page
        .locator("li")
        .filter({ hasText: "Academia" })
        .filter({ hasText: "em hoje" })
        .first()
        .waitFor({ timeout: 20_000 });
      await page.getByRole("button", { name: "Nova", exact: true }).click();
      await dialog()
        .getByPlaceholder(/Netflix/)
        .fill("Spotify E2E");
      await dialog().getByPlaceholder("0,00").fill("21,90");
      await choose(dialog().getByRole("combobox").nth(1), "Cartão Principal");
      await dialog().getByRole("button", { name: "Salvar" }).click();
      await toast(/Assinatura criada/);
      const rec = await q(
        "SELECT credit_card_id, start_date::text AS s, billing_day FROM recurring_expenses WHERE name='Spotify E2E'",
      );
      assert.equal(rec.length, 1);
      await api.db.query("SELECT private.run_financial_daily_maintenance()");
      const charged = Number(
        await one(
          "SELECT count(*) FROM transactions t JOIN recurring_expenses r ON r.id=t.recurring_id WHERE r.name='Spotify E2E'",
        ),
      );
      assert.equal(
        charged,
        rec[0].billing_day === Number(today.slice(8)) ? 1 : 0,
        "sem cobrança retroativa",
      );
      await shot("assinaturas");
    },
  );

  await scenario("recargas: receber o salário cria uma receita e o cron não duplica", async () => {
    await go("/recharges");
    await page
      .locator("li")
      .filter({ hasText: "Salário" })
      .getByRole("button", { name: "Marcar como recebida" })
      .first()
      .click();
    await toast(/Recarga convertida em receita/);
    const income = await q(
      "SELECT occurred_at::text AS d, amount FROM transactions WHERE type='income' AND description='Salário'",
    );
    assert.equal(income.length, 1);
    assert.equal(income[0].d, today);
    await api.db.query("SELECT private.run_financial_daily_maintenance()");
    assert.equal(
      Number(
        await one(
          "SELECT count(*) FROM balance_recharges WHERE name='Salário' AND status<>'cancelada'",
        ),
      ),
      1,
      "sem cópia do modelo no mesmo mês",
    );
  });

  await scenario("metas: prazo de hoje mostra vence hoje e aporte atualiza a meta", async () => {
    await go("/goals");
    await page.getByText("Vence hoje").first().waitFor({ timeout: 20_000 });
    const input = page.getByPlaceholder("Adicionar R$").first();
    await input.fill("100");
    await input.press("Enter");
    await page
      .waitForFunction(() => document.body.innerText.includes("43.3%"), null, { timeout: 15_000 })
      .catch(() => {});
    assert.equal(
      Number(await one("SELECT current_amount FROM goals WHERE name='Reserva de viagem'")),
      1300,
    );
  });

  await scenario("linha do tempo: eventos de hoje com a data correta", async () => {
    await go("/timeline");
    const label = new Date(`${today}T12:00:00`).toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const group = page
      .locator("div.relative")
      .filter({ has: page.getByText("Hoje", { exact: true }) })
      .first();
    await group.waitFor({ timeout: 20_000 });
    const heading = (await group.locator("h3").first().innerText()).trim();
    assert.equal(
      heading.replace(/\s+/g, " "),
      label.replace(/\s+/g, " "),
      "cabeçalho do dia de hoje",
    );
    await shot("linha-do-tempo");
  });

  await scenario("importar CSV: recusa transferência e importa com conta e categoria", async () => {
    await go("/import");
    const csv = [
      "Data,Valor,Categoria,Descrição,Forma de Pagamento,Tipo,Conta",
      `${brToday},"45,00",Alimentação,Feira CSV,Pix,Despesa,Banco digital`,
      `${brToday},"300,00",Freelance,Projeto CSV,Pix,Receita,Banco digital`,
      `${brToday},"100,00",,Transferência CSV,Transferência,Transferência,Banco digital`,
    ].join("\n");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByText("2 válidas").waitFor({ timeout: 15_000 });
    await page
      .getByText(/Transferências e pagamentos de fatura não entram por CSV/)
      .first()
      .waitFor();
    await page.getByRole("button", { name: "Importar 2 transações" }).click();
    await toast(/2 transações importadas/);
    const rows = await q(
      "SELECT t.description, t.account_id, c.name AS cat FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.description IN ('Feira CSV','Projeto CSV','Transferência CSV') ORDER BY 1",
    );
    assert.deepEqual(
      rows.map((r) => [r.description, r.account_id === bank, r.cat]),
      [
        ["Feira CSV", true, "Alimentação"],
        ["Projeto CSV", true, "Freelance"],
      ],
    );
  });

  await scenario("histórico: desfazer a importação CSV remove as duas transações", async () => {
    assert.equal(
      Number(
        await one(
          "SELECT count(*) FROM transactions WHERE description IN ('Feira CSV','Projeto CSV')",
        ),
      ),
      2,
      "a importação CSV precisa existir antes da reversão",
    );
    await go("/history");
    await page.getByRole("button", { name: "Detalhes e reversão" }).first().click();
    await page.getByRole("button", { name: "Reverter esta ação" }).click();
    await page.getByRole("button", { name: "Confirmar reversão" }).click();
    await toast(/Ação revertida/);
    assert.equal(
      Number(
        await one(
          "SELECT count(*) FROM transactions WHERE description IN ('Feira CSV','Projeto CSV')",
        ),
      ),
      0,
    );
  });

  await scenario("investimentos: aporte manual sai da conta e aumenta a posição", async () => {
    await go("/investments");
    const invested = Number(
      await one("SELECT invested_amount FROM investments WHERE name='CDB Liquidez'"),
    );
    await page.getByRole("button", { name: "Registrar aporte" }).first().click();
    await dialog().getByPlaceholder("0,00").fill("250");
    await choose(dialog().getByRole("combobox").last(), "Banco digital");
    await dialog().getByRole("button", { name: "Confirmar" }).click();
    await toast(/Aporte registrado/);
    assert.equal(
      Number(await one("SELECT invested_amount FROM investments WHERE name='CDB Liquidez'")),
      invested + 250,
    );
    assert.equal(
      Number(await one("SELECT count(*) FROM transactions WHERE flow='contribution'")),
      1,
    );
    await shot("investimentos");
  });

  await scenario("painel e carteira global exibem patrimônio sem erro", async () => {
    await go("/dashboard");
    await page
      .getByText(/Patrimônio/i)
      .first()
      .waitFor({ timeout: 20_000 });
    await go("/global-wallet");
    await page
      .getByText(/R\$\s?[\d.]+,\d{2}/)
      .first()
      .waitFor({ timeout: 20_000 });
    await shot("carteira-global");
  });

  await scenario("configurações: salvar preferências", async () => {
    await go("/settings");
    await page.getByRole("button", { name: "Salvar preferências" }).click();
    await toast(/Preferências salvas/);
  });

  await scenario("configurações: titular convida e o convidado vê o convite", async () => {
    await go("/settings");
    await page.getByLabel("E-mail do espectador").fill(GUEST.email);
    await page.getByRole("button", { name: "Conceder acesso" }).click();
    await toast(/Convite enviado/);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login(GUEST);
    await go("/settings");
    await page.getByText(`Convite de ${OWNER.email}`).waitFor({ timeout: 20_000 });
    await shot("convite-recebido");
  });

  await scenario("espectador: vê os dados do titular sem ações de escrita", async () => {
    await page.evaluate(() => localStorage.clear());
    await login(VIEWER);
    await go("/import-prints");
    await page
      .getByText(/itens ·/)
      .first()
      .waitFor({ timeout: 20_000 });
    assert.equal(await page.getByRole("button", { name: "Salvar lançamento" }).count(), 0);
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    await go("/transactions");
    await page.getByText("Supermercado").first().waitFor({ timeout: 20_000 });
    await shot("espectador");
  });
}
