# Validação independente do PR #3 (commit 0e1167b8)

Comparado a `main` d4e5128 — 50 arquivos, 2 commits. Nenhum arquivo do projeto foi alterado, nenhuma migration foi aplicada.

## Resultado dos testes em Linux

- TypeScript (`tsgo --noEmit`): sem erros.
- Build de produção (`vite build`): sucesso em ~13 s.
- Suíte do PR (`node tests/financial-ledger.test.mjs`, PGlite executando as três migrations reais): 19 verificações, todas passaram — parcelas/centavos, dupla quitação, estorno, ownership cruzado, RESTRICT, fatura manual, Planejador com entrada, OCR atômico, convite de espectador, série de caixa e recorrência de cartão pelo cron sem JWT.
- ESLint: falha, mas com 1.226 erros de formatação contra 1.118 já existentes na `main` (inclusive em arquivos não tocados pelo PR). Ruído pré-existente, não é regressão do PR.

## Bloqueador real (1)

**`supabase/migrations/20260904190200_full_project_hardening.sql`, linhas 7–11** — o bloco `UPDATE storage.buckets SET file_size_limit … WHERE id='transaction-prints'` não pode ser aplicado por migration no Lovable Cloud: qualquer SQL de INSERT/UPDATE em `storage.buckets` é recusado pela camada de migrations. O restante do arquivo é válido (as policies em `storage.objects` são permitidas). Ao aplicar, esse trecho precisa sair da migration e o limite de 10 MB + MIME types ser configurado pela ferramenta de bucket. O bucket hoje está com `file_size_limit` nulo, então o ajuste é necessário — só não por este caminho.

## Verificações de pré-condição no banco atual (d4e5128)

Nada bloqueia a aplicação:

- 0 transações, 0 faturas, 0 cartões com limite usado — o `RAISE` de guarda da 20260904190000 passa.
- Nenhum registro viola os novos CHECK (recargas, orçamentos, limites, metas, investimentos, recorrências, compras, preferências, OCR).
- `user_roles`: nenhum usuário com mais de um papel e nenhum viewer sem `owner_id` — o índice único e o CHECK novos passam.
- `private.list_my_viewers()` e `public.list_my_viewers()` existem, então os `DROP FUNCTION` sem `IF EXISTS` não falham.

## Impacto de dados a comunicar (não bloqueia)

**15 assinaturas ativas no crédito** serão movidas para `paused` pela 20260904190200 (linhas 59–62), porque passam a exigir cartão vinculado. Depois de aplicar, é preciso escolher o cartão de cada uma e reativar.

## Itens auditados sem falha

- RLS/privilégios: `credit_card_bill_items` só leitura por `space_owner`; escrita apenas por trigger `SECURITY DEFINER`; `REVOKE` de PUBLIC/anon em todas as funções novas; `REVOKE CREATE ON SCHEMA public`.
- Recorrência no cartão: `apply_card_purchase` aceita o cron sem JWT apenas quando a linha casa exatamente com uma recorrência ativa (mesmo titular, cartão, valor e nome); qualquer outro caminho exige admin titular.
- Entrada do Planejador: a entrada vira transação em conta e só o valor financiado vai para o cartão, com `down_payment_transaction_id` registrado.
- OCR: `save_ocr_detected_transaction` é idempotente (retorna a transação já salva) e valida titularidade de conta, categoria e cartão.
- Convites de espectador: exigem aceite do alvo, expiram em 7 dias, um pendente por par, e sair/revogar devolve o papel de admin.
- OAuth: `safeOAuthRedirect` bloqueia esquemas não-HTTPS (exceto localhost) e credenciais embutidas na URL.
- Visão Geral: o diff em `dashboard.tsx` toca apenas o item da lista de últimos lançamentos (ícone, rótulo e sinal). Cards, gráficos e alertas intactos.

## Veredito

Apto para merge. Para a aplicação no banco, tratar o único bloqueador movendo o ajuste do bucket para fora da migration.

## Próximo passo proposto

Se aprovado, eu aplico as três migrations (com o bloco de `storage.buckets` retirado da 190200), configuro o bucket `transaction-prints` com limite de 10 MB e MIME types JPEG/PNG/WebP pela ferramenta própria, e listo as 15 assinaturas no crédito que ficaram pausadas para você escolher o cartão de cada uma.
