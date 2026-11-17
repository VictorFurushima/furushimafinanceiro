# Patch de 17/11/2026: import por print sem retrabalho de datas

Data: 17/11/2026. Base: `0cff2f0` (main, merge do PR #9).
Branch: `claude/furushima-audit-completo-a40zdy`, recriada a partir da `main`.

## Problema relatado

Prints de SMS do Cartão XP ("Cartao XP: Compra Aprovada de R$ 9,28 em DL\*UberRides no seu cartao
adicional final 5461") chegavam à revisão sem data, com o aviso "ano não visível". Mensagens cortadas
viravam itens vazios para revisar.

Situação em produção antes do patch (somente leitura):

| Medida                         | Valor                                                     |
| ------------------------------ | --------------------------------------------------------- |
| Itens aguardando revisão       | 140 em 27 prints                                          |
| Itens sem data                 | 140 (todos)                                               |
| Itens com aviso de ano ausente | 125                                                       |
| Itens cortados, sem valor      | 3                                                         |
| Compra negada lida como item   | 1                                                         |
| Itens sem forma de pagamento   | vários, apesar do "final 5461" do único cartão cadastrado |

## Causas

1. A instrução da IA (v2) proibia usar o ano corrente: "dd/mm sem ano só vira data com evidência
   de ano. Não use o ano atual por suposição". O próprio exemplo de aviso era "Data: ano não visível".
2. O SMS do iPhone mostra "sex., 6 de nov." (sem ano) para datas antigas e só "sexta-feira, 19:29"
   na última semana. Nenhum dos dois formatos era resolvido.
3. Cabeçalhos de data valiam "só para as linhas do grupo". Mensagens abaixo de um cabeçalho, sem
   data no próprio texto (51 itens), ficavam sem data.
4. A normalização mantinha itens sem valor e compras negadas, e pedia forma de pagamento mesmo
   quando o final do cartão identificava um cartão de crédito cadastrado.

## O que mudou

### Datas (`src/lib/ocr-date.ts`, novo)

`resolveOcrDateLabel(rótulo, referência)` converte o rótulo do print em data, relativo ao dia em
que o print foi tirado (campo "Data de referência do print"):

| Rótulo                     | Regra                                        | Referência 17/11/2026 |
| -------------------------- | -------------------------------------------- | --------------------- |
| `sex., 6 de nov., 19:30`   | Ano da referência                            | 06/11/2026            |
| `20/12`                    | Ano anterior se cair depois da referência    | 20/12/2025            |
| `sexta-feira, 19:29`       | Último dia com esse nome antes da referência | 13/11/2026            |
| `Hoje` / `Ontem`           | Referência / dia anterior                    | 17/11 / 16/11         |
| `06/11/2025`, `2026-10-01` | Ano explícito é preservado                   | igual ao print        |
| `31/02`, `19:30`           | Sem data válida                              | vazio                 |

Conferido com os 23 rótulos distintos que a IA transcreveu dos seus prints. As 23 datas
calculadas têm o mesmo dia da semana escrito no print, o que confirma 2026 como ano.

### Leitura por IA (`src/lib/ocr-prompt.ts`, versão `2026-11-17.v3`)

- Aplica o ano corrente, os dias da semana e "Hoje"/"Ontem" pelas regras acima.
- Um cabeçalho de data vale para todas as mensagens abaixo dele até o próximo cabeçalho.
- Novo campo `date_text`: o rótulo de data copiado do print. O servidor recalcula a data a partir
  dele, então um ano errado da IA não chega à revisão.
- **Não inclui:** movimentação cortada sem valor ou estabelecimento legível, compra negada,
  recusada ou cancelada, e mensagem sem nenhuma data visível. Esses casos só são contados num
  aviso curto do print.
- Ano ausente e dia da semana deixam de ser "dúvida". A instrução pede no máximo 300 caracteres
  de texto lido por item, contra 800 antes, para gastar menos tokens de saída.

### Normalização (`src/lib/ocr-schema.ts`, `src/lib/ocr.functions.ts`)

- Descarta, com aviso, os itens cortados, as compras negadas e os itens sem nenhuma data. Esses
  descartes não tornam a leitura "parcial".
- Resolve a data pelo `date_text` e pela data de referência.
- Forma de pagamento vazia com "final NNNN" de um cartão de crédito ativo do titular vira crédito.
- Remove os avisos da IA que essas regras já resolveram (data, ano, pagamento). Um item sem
  dúvidas restantes, efetivado e com confiança alta não exige mais a caixa "Conferi os campos".

### Tela (`src/routes/_app/import-prints.tsx`, `src/lib/ocr-review.ts`)

- **Ler de novo:** aviso no topo quando há prints com itens pendentes lidos por uma versão anterior.
  Um clique relê todos com a regra nova. Itens salvos ou ignorados são mantidos.
- **Selecionar prontos (N):** seleciona de uma vez os itens sem pendência e sem possível
  duplicata. Depois, "Salvar selecionados".
- **Para salvar, falta: …** em cada item bloqueado (ex.: "data, confirmação dos avisos"), em vez
  de um botão desabilitado sem explicação.
- **Possível duplicata:** dois caminhos claros, "Usar este lançamento existente" ou "É outra
  movimentação: salvar mesmo assim". Saiu o botão "Rever duplicação antes de salvar", que não fazia
  nada.
- A ajuda da data de referência explica que ela resolve Hoje, Ontem, dias da semana e datas sem ano.

## Depois de publicar

1. Abrir **Importar por Print** e clicar em **Ler de novo**. Os 27 prints pendentes são relidos com a
   regra nova; a referência gravada deles é 17/11/2026.
2. Clicar em **Selecionar prontos** e depois em **Salvar selecionados**.
3. Itens restantes mostram o que falta; possíveis duplicatas pedem uma escolha.

## Testes

- `test:import-installments` 34 (novos: rótulos de data, SMS com cabeçalho e cartão, descartes,
  "o que falta"), `test:finance` 19, `test:history` 27, `test:investments` 22, `test:recurrence` 10 e
  `test:viewers` 5: todos passaram.
- `tsc --noEmit`, ESLint e Prettier nos arquivos alterados passaram.
- Teste ponta a ponta do site inteiro: 42/42, sem erros de console ou de API. Inclui o aviso
  "Ler de novo", "Selecionar prontos" e "Para salvar, falta".

## Observação

O `bun.lock` da `main` está defasado: o Lovable subiu `@lovable.dev/vite-tanstack-config` para
2.26.5 no `package.json`, mas o lock ainda registra 2.25.3. `bun install --frozen-lockfile` falha
por isso. Este patch não altera o lock.

## Rollback

Reverter o commit `fix(ocr)` desta branch. A leitura volta à versão `2026-09-22.v2` e a tela volta
ao comportamento anterior. Itens já relidos ou salvos não mudam.
