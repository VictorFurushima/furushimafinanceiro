# PATCH 2026-08-31 — OCR, Performance e Hardening

- **Projeto:** Furushima Financeiro
- **Data:** 2026-08-31
- **Status:** Aplicado e validado (tsgo, ESLint, build de produção, inspeção SQL no banco)
- **Commits relacionados:** `c3dd7b61ca54817d845c8bacee1aa909e0a4c561`, `39906152b8f8bb05031f0608af039fa55cf21562`
- **Documentos relacionados:** `docs/BUGFIX_AUDIT_2026-08-31.md` (auditoria + segunda revisão de hardening), `docs/DATABASE_ARCHITECTURE.md`

---

## 1. Objetivo do patch

Corrigir bugs de datas no Importar por Print, eliminar risco de perda de dados na releitura OCR,
reduzir a lentidão (sessão duplicada, N+1 de duplicidade, 7 roundtrips do dashboard) e alinhar as
queries OCR ao índice parcial existente — sem redesign, sem remover funcionalidades, sem afrouxar
RLS e sem alterar o modelo admin/viewer.

## 2. Estado anterior e sintomas

- Reconhecimento errado de datas no import por print (ano inventado, dia anterior/posterior por fuso).
- Lentidão geral percebida no app.
- Listeners de auth repetidos: cada `useAuth()` criava um `onAuthStateChange` + `getSession()`
  próprios (multiplicados por linha em listas como `DetectedRow`).
- OCR com N+1: um `SELECT` de duplicidade por transação detectada.
- Dashboard com **7 roundtrips** iniciais (overview, mês atual, mês anterior, spending, séries,
  transações recentes, snapshot).
- Queries OCR sem limite de registros e com filtro `neq` incompatível com o índice parcial.
- Risco de perda na releitura OCR: `DELETE` do conjunto anterior acontecia antes do `INSERT` novo;
  falha no insert deixava a imagem sem dados.

## 3. Causas raiz

- **Datas:** `new Date("YYYY-MM-DD")` interpretado como UTC exibia o dia anterior no Brasil;
  `toISOString().slice(0,10)` adiantava o dia após 21h BRT. O prompt do OCR dizia "assuma o ano
  atual" sem informar data/fuso reais, e datas inválidas eram gravadas sem validação.
- **Auth:** o hook `useAuth` mantinha estado/listener local por componente em vez de consumir uma
  fonte única.
- **OCR N+1:** `dupOf` fazia um `SELECT` por transação detectada.
- **Releitura OCR:** ordem destrutiva (DELETE antes de INSERT) sem compensação.
- **Dashboard:** 7 hooks independentes disparando 7 RPCs paralelas.
- **Queries OCR:** `neq('saved')`/`neq('ignored')` não casava com o predicado do índice parcial;
  ausência de `LIMIT` permitia fetch ilimitado.

## 4. Alterações executadas

### FRONTEND

- `src/components/auth-provider.tsx` (novo): provider único de sessão; um `onAuthStateChange` +
  um `getSession()` para toda a árvore; absorve o antigo `AuthInvalidator` (invalida rotas/queries
  em SIGNED_IN/SIGNED_OUT/USER_UPDATED; `qc.clear()` no logout).
- `src/hooks/use-auth.ts`: virou consumidor de contexto puro (sem listeners, sem estado próprio).
- `src/routes/__root.tsx`: monta o `AuthProvider`; removido o `AuthInvalidator` duplicado.
- `src/routes/_app/import-prints.tsx`: `DetectedRow` recebe `userId` por prop (sem `useAuth` por
  linha); queries com filtro explícito `IN ('pending','needs_review')`, limite de 100 prints
  recentes e 250 itens pendentes (aviso discreto ao atingir o teto); upload com validação de
  tipo/tamanho (JPG/PNG/WebP, 10 MB) e concorrência limitada a 2 arquivos.
- `src/routes/_app/dashboard.tsx`: consome apenas `useDashboardBundle`; os 7 hooks individuais
  foram removidos da tela (continuam disponíveis para outras páginas).
- `src/hooks/use-finance-aggregates.ts`: novo `useDashboardBundle` + tipos do bundle.
- Datas: substituídos usos perigosos de `new Date(<coluna DATE>)` e `toISOString().slice(0,10)`
  pelos helpers de `date-only` em dashboard, estatísticas, receitas, transações, recargas, notas,
  investimentos, timeline, análise de compras, MCP e `src/lib/format.ts`.

### BACKEND / SERVER FUNCTIONS

- `src/lib/ocr.functions.ts`:
  - prompt recebe a data local de hoje e o fuso `America/Sao_Paulo`, instrui leitura do ano no
    cabeçalho do extrato/fatura e **proíbe** substituir ano explícito ou inventar ano ausente;
  - validação determinística server-side: formato + calendário real; data inválida/ausente ou valor
    ausente rebaixa a confiança para `baixa` (`needs_review`) em vez de inventar dados;
  - detecção de duplicidade em **lote**: um único `SELECT` por conjunto de datas, comparação
    normalizada em memória (acentos/case/pontuação, tolerância de R$ 0,005, prefixo de 12 chars);
  - releitura **fail-safe** (sequência exata na seção 6);
  - falha ao inserir metadados remove o objeto órfão do Storage.

### DATABASE / SUPABASE

- Migration criada: função pública `get_dashboard_bundle(p_months integer default 6)`
  (`LANGUAGE sql`, `STABLE`, `SECURITY INVOKER`, `search_path = public`, `EXECUTE` revogado de
  PUBLIC/anon). Retorna JSONB com: `overview`, `current_month`, `previous_month`, `spending`,
  `series`, `recent_transactions` (limite 6, com `categories(name,color,icon)`), `snapshot`.
  Reutiliza `get_financial_overview`, `get_monthly_financial_summary`, `get_spending_by_category`,
  `get_monthly_series` e `get_dashboard_snapshot` (nenhuma fórmula duplicada; as RPCs existentes
  não foram alteradas pois outras telas as usam). Mês atual/anterior calculados no Postgres via
  `CURRENT_DATE`/`date_trunc`. Owner resolvido por `public.space_owner((SELECT auth.uid()))`.
- Migration criada: índice parcial `idx_ocr_pending_review (user_id, created_at DESC)` restrito a
  `review_status IN ('pending','needs_review')` — predicado idêntico ao filtro da tela OCR.

### SEGURANÇA / RLS

- Nenhuma policy afrouxada. `get_dashboard_bundle` é `SECURITY INVOKER`: toda leitura passa pela
  RLS existente; viewer continua lendo o espaço do owner via `space_owner`.
- `EXECUTE` de `get_dashboard_bundle` revogado de `PUBLIC` e `anon` (somente `authenticated`).
- OCR mantém verificação `img.user_id = auth.uid()` e download via cliente autenticado (RLS).

### PERFORMANCE

- Sessão: N listeners/getSession → 1 listener + 1 getSession por app.
- Duplicidade OCR: N SELECTs → 1 SELECT em lote.
- Dashboard: 7 roundtrips → 1.
- Queries OCR alinhadas ao índice parcial + limites 100/250.
- Processamento de uploads com concorrência 2 (evita estouro de memória/timeout).

### DOCUMENTAÇÃO

- `docs/BUGFIX_AUDIT_2026-08-31.md`: auditoria + segunda revisão (hardening).
- `docs/DATABASE_ARCHITECTURE.md`: atualizado com `get_dashboard_bundle` e índice OCR.
- `docs/patches/PATCH_2026-08-31_OCR_PERFORMANCE_HARDENING.md` (este arquivo) e índice
  `docs/patches/README.md`.

## 5. Datas — camada `src/lib/date-only.ts`

Helpers: `parseDateOnly`, `formatDateOnlyPtBR`, `toLocalDateString`, `todayISO`,
`isValidDateOnly`, `addDaysISO`, `diffDaysISO`, constante `APP_TIMEZONE = "America/Sao_Paulo"`.

Regras do patch:

- Colunas `DATE` nunca passam por `new Date(string)` nem `toISOString().slice(0,10)`; usam os
  helpers (data civil, sem conversão de fuso).
- Colunas `TIMESTAMPTZ` (agenda/tarefas/alertas) seguem usando `Date` normal — correto, pois
  carregam hora. Não misturar os dois tratamentos.
- OCR: "Hoje"/"Ontem" resolvidos pela data local explícita `America/Sao_Paulo`; ano explícito no
  item é preservado; `dd/mm` sem ano no item **e** sem cabeçalho/período confiável → `date = null`
  + `confidence = "baixa"` (usuário preenche manualmente na revisão); dia/mês/ano ambíguos →
  `date = null`; datas de calendário impossíveis (ex.: 31/02) rejeitadas server-side.

## 6. OCR — fluxo completo e releitura fail-safe

### Fluxo de upload/processamento

1. Upload validado (JPG/PNG/WebP, até 10 MB) para o bucket `transaction-prints`.
2. Insert de metadados em `uploaded_transaction_images`; se falhar, o objeto órfão é removido do
   Storage.
3. Processamento com concorrência limitada a 2 arquivos.
4. Extração via AI Gateway (Gemini) com prompt ciente de data/fuso → parse JSON → validação
   determinística (data/valor/confiança) → matching de categoria (exato → fuzzy → fallback
   "Outros" do tipo) → detecção de duplicidade em lote → insert em `ocr_detected_transactions`.
5. Tela de revisão: até 100 prints recentes e 250 itens `pending`/`needs_review` (aviso discreto
   ao atingir o teto).

### Releitura fail-safe — sequência EXATA

1. Extração + parse + validação determinística concluídos (falha aqui marca a imagem `failed`
   **sem tocar em dados**).
2. Carrega os IDs antigos com `review_status IN ('pending','needs_review')` da imagem
   (`saved`/`ignored` **nunca** entram).
3. Se é releitura, existiam resultados antigos e a nova extração devolveu ZERO transações → erro
   claro, conjunto anterior **preservado**.
4. `INSERT` do novo conjunto com `.select("id")` capturando os IDs inseridos.
5. Somente após sucesso do INSERT, `DELETE` restrito aos IDs antigos capturados.
6. Se o DELETE falhar → **compensação** apagando os IDs recém-inseridos, imagem marcada `failed`,
   conjunto anterior íntegro.

Qualquer falha em AI, parse, validação, INSERT ou DELETE atualiza
`uploaded_transaction_images` para `failed` com `error_message` e preserva os dados anteriores.

## 7. AuthProvider — antes e depois

- **Antes:** cada chamada de `useAuth()` criava `onAuthStateChange` + `getSession()` próprios;
  em listas (ex.: `DetectedRow`) isso multiplicava listeners por linha renderizada. Havia ainda o
  `AuthInvalidator` separado no root (duas assinaturas).
- **Depois:** um único listener e um único `getSession()` no `AuthProvider`; `useAuth` apenas
  consome contexto; invalidação de rotas/queries centralizada no provider. `useRole` segue com uma
  query por usuário (cacheada) — risco residual aceito.

## 8. Dashboard bundle

- Função: `public.get_dashboard_bundle(p_months integer default 6)` → `jsonb`.
- `STABLE`, `SECURITY INVOKER`, `search_path = public`, executável apenas por `authenticated`.
- Reutiliza as RPCs financeiras existentes (zero duplicação de fórmulas); `recent_transactions`
  limitada a 6 e respeita `space_owner`/RLS (viewer lê o espaço do owner).
- Frontend: `useDashboardBundle` com **uma** query; dashboard consumia 7 hooks e passou a 1.
- **Resultado: 7 roundtrips iniciais → 1.**

## 9. Índice `idx_ocr_pending_review`

- Definição: `(user_id, created_at DESC)` com predicado `review_status IN ('pending','needs_review')`.
- Razão: é exatamente o filtro da tela de revisão; índice parcial evita indexar o histórico
  `saved`/`ignored` (maioria dos dados). Índices existentes (`idx_ocr_tx_image`, `idx_ocr_tx_user`,
  `transactions_user_date_idx`, `idx_uploaded_images_user_date`) cobrem os demais acessos — nenhum
  índice redundante foi criado. A query da tela usa `IN ('pending','needs_review')` (não `neq`)
  justamente para casar com o predicado.
- Rollback: `DROP INDEX public.idx_ocr_pending_review;`

## 10. Arquivos principais alterados

- `src/components/auth-provider.tsx` (novo)
- `src/hooks/use-auth.ts`
- `src/routes/__root.tsx`
- `src/routes/_app/import-prints.tsx`
- `src/routes/_app/dashboard.tsx`
- `src/hooks/use-finance-aggregates.ts`
- `src/lib/ocr.functions.ts`
- `src/lib/date-only.ts` (novo) + consumidores (dashboard, statistics, income, transactions,
  recharges, notes, investments, timeline, shopping-analysis, MCP, `src/lib/format.ts`)
- `src/lib/query-keys.ts` (chave do bundle)
- Docs: `docs/BUGFIX_AUDIT_2026-08-31.md`, `docs/DATABASE_ARCHITECTURE.md`, `docs/patches/*`

**Migrations criadas:** (1) índice parcial `idx_ocr_pending_review`; (2) função
`public.get_dashboard_bundle(p_months integer)`.

## 11. React Query — chaves e invalidação

- Nova chave: `financeKeys.dashboardBundle(months)`, sob o prefixo `finance` → coberta por
  `invalidateFinance` (transações/finanças invalidam o bundle automaticamente).
- QueryClient financeiro mantém `staleTime` 60s e `gcTime` 10 min; sem `refetchOnWindowFocus`.
- Logout faz `qc.clear()`; login/atualização de usuário faz `invalidateQueries()` — ambos
  centralizados no `AuthProvider`.

## 12. Validações executadas

- `tsgo --noEmit`: sem erros.
- ESLint em todos os arquivos tocados: sem erros.
- Build de produção: sucesso.
- Função `get_dashboard_bundle` inspecionada no banco: `STABLE`, `SECURITY INVOKER`,
  `search_path = public`, `EXECUTE` revogado de PUBLIC/anon.
- Verificado que não restaram `new Date(<DATE>)`/`toISOString().slice(0,10)` em arquivos
  financeiros e que imports não usados da auditoria foram removidos.

## 13. Não validado automaticamente

- Precisão real do AI Gateway (Gemini) na leitura de prints reais do usuário.
- Comportamento visual em aparelhos físicos (layout não foi alterado neste patch).

## 14. Riscos residuais e decisões

- `useRole` mantém uma query por usuário (cacheada) — não tratado neste patch.
- Dados históricos já gravados pelo OCR com datas potencialmente inventadas **não** foram
  corrigidos automaticamente (decisão deliberada: não alterar dado financeiro histórico sem
  revisão humana; o usuário pode reler os prints afetados — a releitura agora é fail-safe).
- `get_dashboard_snapshot` e demais RPCs antigas seguem no banco pois outras telas as consomem.

## 15. Como testar manualmente

1. **Login/sessão:** login, refresh de página, logout e navegação entre telas; a tela de
   carregamento inicial deve aparecer uma única vez.
2. **Fuso:** lançar uma transação após as 21h (BRT) e conferir que a data exibida é a do dia
   correto; abrir listagens com meses anteriores.
3. **OCR "Hoje/Ontem":** enviar print com "Hoje"/"Ontem" e conferir as datas resolvidas.
4. **OCR ano explícito:** print com ano no item deve preservá-lo; print `dd/mm` sem ano e sem
   cabeçalho → item entra como `needs_review` com data vazia.
5. **Releitura fail-safe:** reler um print com o gateway indisponível (ex.: rede offline) → o
   conjunto anterior deve continuar na tela e a imagem marcada como `failed`.
6. **Duplicidade:** reimportar print de período já lançado → itens marcados `possible_duplicate`
   sem múltiplas requisições (observar 1 SELECT em lote nas ferramentas de rede).
7. **Limites:** com muitos pendentes, a tela exibe no máximo 100 prints/250 itens com aviso
   discreto.
8. **Dashboard:** abrir o painel e conferir nas ferramentas de rede **1** chamada RPC de dados
   financeiros; valores idênticos aos de antes do patch.

## 16. Rollback lógico do patch

- **Índice:** `DROP INDEX public.idx_ocr_pending_review;` (migration reversa trivial).
- **Função `get_dashboard_bundle`:** exige migration reversa (`DROP FUNCTION
  public.get_dashboard_bundle(integer);`) **junto** com o revert do `dashboard.tsx` para os 7
  hooks individuais — dropar a função sem reverter o frontend quebra a tela.
- **Frontend (dashboard, import-prints, auth-provider, date-only):** revertível via git nos
  commits relacionados; não há dependência de schema.
- **OCR fail-safe e prompt:** revertível via git; não há estado persistido dependente da ordem
  nova (a ordem antiga é que era destrutiva).
- **Não reverter** dados: nenhum dado histórico foi alterado por este patch.

## 17. Resultado final e métricas objetivas

- Dashboard: **7 → 1 roundtrip** inicial de dados financeiros.
- Duplicidade OCR: **N SELECTs → 1** (N+1 eliminado).
- Sessão: **N listeners/getSession → 1 + 1**.
- Releitura OCR: **zero janelas de perda** — nenhuma falha em AI/parse/validação/INSERT/DELETE
  destrói o conjunto anterior.
- Datas OCR: ano nunca é inventado; itens ambíguos vão para revisão manual.
- Tela OCR: fetch limitado (100 prints / 250 itens) e alinhado a índice parcial.

---

## CONTEXTO PARA PRÓXIMA IA

Estado pós-patch (2026-08-31):

- Sessão é **fonte única** via `AuthProvider`; `useAuth` só consome contexto. Nunca criar
  `onAuthStateChange`/`getSession` em componentes ou hooks.
- Datas de colunas `DATE` passam obrigatoriamente por `src/lib/date-only.ts`
  (`America/Sao_Paulo`); `TIMESTAMPTZ` segue com `Date` normal. Proibido
  `new Date("YYYY-MM-DD")` e `toISOString().slice(0,10)` em dados financeiros.
- OCR (`src/lib/ocr.functions.ts`) é **fail-safe**: captura IDs antigos → valida → insere novo →
  deleta antigos → compensa se o delete falhar. `saved`/`ignored` nunca são tocados. Essa ordem
  **não deve ser desfeita**.
- O prompt do OCR proíbe inventar ano; data ambígua = `null` + `needs_review`. Não "melhorar" o
  prompt reintroduzindo suposição de ano.
- Dashboard usa **apenas** `useDashboardBundle` (`financeKeys.dashboardBundle`, invalidado por
  `invalidateFinance`). Não reintroduzir chamadas paralelas às RPCs individuais nessa tela; as
  RPCs antigas continuam existindo para outras páginas — não removê-las.
- A query da tela OCR usa `IN ('pending','needs_review')` de propósito (casa com o índice parcial
  `idx_ocr_pending_review`); não trocar por `neq`.
- Dados históricos OCR não foram corrigidos automaticamente — decisão deliberada; correção é via
  releitura manual pelo usuário.

**Ler antes de mexer nesta área:**

1. `docs/BUGFIX_AUDIT_2026-08-31.md` (auditoria completa + segunda revisão)
2. `docs/DATABASE_ARCHITECTURE.md` (RPCs, índices, RLS, jobs)
3. `docs/CHANGE_CONVENTIONS.md`
4. `src/lib/ocr.functions.ts`, `src/lib/date-only.ts`, `src/components/auth-provider.tsx`,
   `src/hooks/use-finance-aggregates.ts`, `src/lib/query-keys.ts`
