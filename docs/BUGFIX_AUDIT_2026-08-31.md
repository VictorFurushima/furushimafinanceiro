# Auditoria corretiva — 2026-08-31

Correções sem redesign, preservando funcionalidades, layout, RLS e o modelo admin/viewer.

## 1. Sessão duplicada (autenticação/performance)

- **Bug:** cada chamada de `useAuth()` criava um `onAuthStateChange` + `getSession()`. Em listas
  (ex.: `DetectedRow` no Importar por Print) isso multiplicava listeners por linha renderizada.
- **Causa raiz:** o hook mantinha estado local em vez de consumir uma fonte única.
- **Correção:** `src/components/auth-provider.tsx` concentra um único listener e um único
  `getSession()`; `src/hooks/use-auth.ts` virou apenas consumidor de contexto. O antigo
  `AuthInvalidator` do root foi absorvido pelo provider (uma assinatura em vez de duas).
  `DetectedRow` passou a receber `userId` por prop.
- **Arquivos:** `src/components/auth-provider.tsx`, `src/hooks/use-auth.ts`,
  `src/routes/__root.tsx`, `src/routes/_app/import-prints.tsx`.
- **Risco residual:** nenhum conhecido; `useRole` continua com uma query por usuário (cacheada).
- **Como testar:** login, refresh, logout e navegação entre páginas; a tela de carregamento inicial
  deve aparecer uma única vez e o redirecionamento para `/login` continuar funcionando.

## 2. Datas (DATE vs. fuso)

- **Bug:** `new Date("YYYY-MM-DD")` é interpretado como UTC e exibia o dia anterior no Brasil;
  `toISOString().slice(0,10)` podia adiantar o dia após 21h (BRT).
- **Correção:** nova camada `src/lib/date-only.ts` (`parseDateOnly`, `formatDateOnlyPtBR`,
  `toLocalDateString`, `todayISO`, `isValidDateOnly`, `addDaysISO`, `diffDaysISO`). Substituídas as
  ocorrências perigosas em dashboard, estatísticas, receitas, transações, recargas, notas,
  investimentos, timeline, análise de compras, MCP e `src/lib/format.ts`.
- **Risco residual:** colunas `timestamptz` (agenda/tarefas/alertas) seguem usando `Date` normal —
  correto, pois carregam hora.
- **Como testar:** lançar uma transação após as 21h e conferir a data listada; abrir listagens com
  datas de meses anteriores.

## 3. OCR — datas, N+1 e robustez

- **Bug:** o prompt mandava "assuma o ano atual" sem informar a data/fuso reais; datas inválidas
  eram gravadas; `dupOf` fazia um SELECT por transação detectada; a releitura apagava o conjunto
  anterior antes de saber se a nova leitura daria certo; falha ao inserir metadados deixava o
  arquivo órfão no Storage.
- **Correção (`src/lib/ocr.functions.ts`, `src/routes/_app/import-prints.tsx`):**
  - prompt recebe a data local de hoje e o fuso `America/Sao_Paulo`, instrui leitura do ano no
    cabeçalho do extrato/fatura e proíbe substituir ano explícito;
  - validação determinística server-side: formato + calendário real; data inválida/ausente ou valor
    ausente rebaixa a confiança para `baixa` (`needs_review`) em vez de inventar data;
  - duplicidade em lote: um único SELECT por conjunto de datas, comparação normalizada em memória;
  - releitura idempotente: o servidor só remove o conjunto anterior (`pending`/`needs_review`)
    depois que a nova leitura foi concluída (`replacePrevious`);
  - upload com limite explícito (JPG/PNG/WebP, 10 MB) e remoção do objeto órfão quando o insert de
    metadados falha;
  - processamento com concorrência limitada a 2 arquivos.
- **Como testar:** enviar print com "Hoje/Ontem", print com ano explícito e print ilegível; reler um
  print com o gateway indisponível (o conjunto anterior deve continuar na tela).

## 4. Índice da tela OCR

- **Migration:** índice parcial `idx_ocr_pending_review (user_id, created_at DESC)` restrito a
  `review_status IN ('pending','needs_review')`, que é exatamente o filtro da tela. Índices
  existentes (`idx_ocr_tx_image`, `idx_ocr_tx_user`, `transactions_user_date_idx`,
  `idx_uploaded_images_user_date`) já cobrem os demais acessos — nenhum índice redundante criado.
- **Rollback:** `DROP INDEX public.idx_ocr_pending_review;`

## Verificações executadas

- TypeScript (`tsgo --noEmit`): sem erros.
- ESLint nos arquivos alterados: sem erros.
- Build de produção: executado com sucesso.

## Não validado automaticamente

- Leitura real de prints pelo AI Gateway (depende de imagens do usuário).
- Comportamento visual em aparelhos físicos; layout não foi alterado nesta auditoria.

## Segunda revisão — patch de hardening (2026-08-31)

### 1. Releitura OCR fail-safe (`src/lib/ocr.functions.ts`)
Sequência exata, nesta ordem:
1. extração + parse + validação determinística concluídos (falha aqui marca a imagem como `failed` sem tocar em dados);
2. carrega os IDs antigos com `review_status IN ('pending','needs_review')` da imagem (`saved`/`ignored` nunca entram);
3. se é releitura, existiam resultados antigos e a nova extração devolveu ZERO transações → erro claro, conjunto anterior preservado;
4. INSERT do novo conjunto com `.select("id")` capturando os IDs inseridos;
5. somente após sucesso do INSERT, DELETE restrito aos IDs antigos capturados;
6. se o DELETE falhar → compensação apagando os IDs recém-inseridos, imagem marcada `failed`, conjunto anterior íntegro.
Qualquer falha em AI, parse, validação, INSERT ou DELETE atualiza `uploaded_transaction_images` para `failed` com `error_message` e preserva os dados anteriores.

### 2. Datas ambíguas no prompt
Sem ano no item e sem cabeçalho/período confiável → `date = null` e `confidence = "baixa"`. Dia/mês/ano ambíguos → `date = null`. Ano explícito preservado; "Hoje"/"Ontem" resolvidos pela data local `America/Sao_Paulo`. Validação server-side segue rejeitando calendário impossível.

### 3. Query OCR alinhada ao índice
`import-prints.tsx` usa `IN ('pending','needs_review')` (mesmo predicado de `idx_ocr_pending_review`), limite de 100 prints recentes e 250 itens pendentes, com aviso discreto ao atingir o teto. Selects permanecem explícitos.

### 4. Bundle do dashboard: 7 roundtrips → 1
Nova função `public.get_dashboard_bundle(p_months integer default 6)` — `LANGUAGE sql`, `STABLE`, `SECURITY INVOKER`, `search_path = public`. Reutiliza `get_financial_overview`, `get_monthly_financial_summary`, `get_spending_by_category`, `get_monthly_series` e `get_dashboard_snapshot`; mês atual/anterior calculados no Postgres via `CURRENT_DATE`/`date_trunc`; `recent_transactions` limitada a 6 com `categories(name,color,icon)` e owner resolvido por `public.space_owner((SELECT auth.uid()))`. `EXECUTE` revogado de PUBLIC/anon.
Frontend: `useDashboardBundle` (`financeKeys.dashboardBundle(months)`, sob o prefixo `finance` → coberto por `invalidateFinance`). `dashboard.tsx` consome apenas o bundle; os 7 hooks individuais foram removidos da tela (continuam disponíveis para as demais páginas).

### 5. Limpeza
Imports não usados de `date-only` removidos do dashboard (`toLocalDateString`, `todayISO`). Nenhum `toISOString().slice(0,10)` ou `new Date(<coluna DATE>)` restante em arquivos financeiros. Validado com `tsgo --noEmit`, ESLint nos arquivos tocados e build de produção.
