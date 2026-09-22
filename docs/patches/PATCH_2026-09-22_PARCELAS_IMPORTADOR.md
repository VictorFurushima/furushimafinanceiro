# PATCH 2026-09-22 — Parcelas e importação por print

## Objetivo

Entregar duas funcionalidades independentes: uma área para acompanhar compras
parceladas no cartão e uma revisão confiável antes de importar movimentações de
imagens. A importação por print não identifica nem cria planos de parcelas.

Base anterior: `ad92d5b504ab17e88f4e6747108092c1cffe847d`.
Branch: `feat/parcelas-importador-20260922`.
Prompt OCR: `2026-09-22.v2`.

## Parcelas

- Nova rota `/installments`, separada de Assinaturas, disponível no menu desktop
  e no menu Mais do celular.
- Cadastro de compra parcelada no cartão: valor total e 2–120 parcelas.
- Por compra: cartão, total, pago, restante, progresso, próximo e último
  vencimento; detalhamento de parcelas pagas, pendentes e vencidas.
- Filtros por cartão, situação e descrição; paginação de 20 compras.
- Resumo e projeção de 12 meses calculados no PostgreSQL. Totais seguem cartão
  e busca; situação filtra a lista, conforme explicado na tela.
- Reutiliza `transactions`, `credit_card_bill_items` e `credit_card_bills`.
  Quitação permanece nas Faturas; não cria outro ledger nem altera o regime da
  Visão Geral. Carnês e boletos parcelados ficam fora desta etapa.

## Importação por print

- Prompt versionado instrui leitura de todos os blocos e bordas, preserva linhas
  parciais, distingue entrada/saída/transferência própria, estorno e pagamento de
  fatura, e exclui saldos, limites e totais que não são movimentações.
- Hoje/Ontem usam a data de referência ajustável. Ano ou campo sem evidência
  permanece vazio com aviso; a aplicação não completa por adivinhação.
- Resposta validada por esquema; JSON inválido, truncamento e falhas de leitura
  não apagam a revisão anterior. Contagem divergente gera aviso de leitura parcial.
- Texto de evidência, campos editáveis, imagem original e avisos ficam disponíveis
  na revisão. Guardar revisão persiste os campos para continuar depois.
- Reenvio do mesmo arquivo reconhece seu SHA-256 e abre a revisão existente,
  sem nova chamada de IA. Imagens aceitas: JPG/PNG/WebP, até 10 MB; duas leituras
  simultâneas no máximo por envio. Releitura é uma ação explícita.
- Comparação com transações salvas e itens pendentes, inclusive de outros prints.
  Duplicatas prováveis podem ser vinculadas ao lançamento existente ou confirmadas
  como outra movimentação. Itens incompletos ou com duplicação conhecida não entram
  no salvamento em lote. O banco verifica cada confirmação novamente.
- Pagamento de fatura orienta quitar em Cartões e vincular o pagamento existente.
  Transferência própria exige origem e destino; não vira uma nova despesa.
- Excluir um print preserva transações e recibos de importação. Se a transação
  original foi excluída, recriá-la exige confirmação específica.

## As verificações antes do banco final

| Etapa | Proteção |
| --- | --- |
| Arquivo | Hash único por titular e trava temporária de processamento |
| Leitura | Prompt + validação estrutural + avisos por campo |
| Revisão | PK do item; FKs da imagem, contas, cartão e categoria |
| Comparação | Data, valor, tipo, conta/cartão e descrição normalizada; até 5 exemplos |
| Confirmação | Bloqueio por titular, nova checagem e gravação em uma transação de banco |
| Memória durável | `ocr_import_receipts`: origem única e referência bancária confirmada única no escopo da conta/cartão |

PK identifica registros; FK mantém os vínculos; UNIQUE e a transação atômica
impedem repetir a mesma identidade reconhecida. Cache acelera consultas e nunca
autoriza uma importação. Uma impressão recortada ou com OCR diferente pode ter
outra identidade: similaridade é um aviso, não prova automática de duplicação.
Duas compras reais de mesmo valor/data continuam possíveis após revisão.

## Banco e implantação

Migrations incrementais, em ordem:

1. `20260922180000_installments_dashboard.sql`: RPC paginada de parcelas; somente leitura.
2. `20260922181000_ocr_review_pipeline.sql`: metadados, hash, origem dos itens,
   FKs/índices, leitura protegida e revisão paginada.
3. `20260922182000_ocr_import_receipts.sql`: recibos persistentes, RLS,
   validação de titularidade, backfill dos vínculos salvos e gravação atômica.

Não há criação de movimentações financeiras na implantação. O backfill registra
vínculos OCR já existentes. O banco conectado estava sem transações/prints na
inspeção inicial. Novas escritas exigem administrador; viewers leem o espaço do
titular. A função legada de salvar OCR encaminha para a mesma proteção.

Implantar banco antes do frontend; registrar as versões em `schema_migrations`,
recarregar o esquema PostgREST, integrar a branch e verificar a publicação no
Lovable. Não reaplicar migrations já registradas.

## Validação

- 22 cenários novos de normalização, falha segura, duplicatas, idempotência,
  referência bancária, exclusão/reimportação, titularidade, viewer e parcelas:
  `npm run test:import-installments`.
- 19 verificações financeiras existentes: `npm run test:finance`.
- TypeScript, lint direcionado e build de produção.
- Navegador local com dados simulados em 1440, 390 e 320 px: telas, detalhes de
  parcelas, formulário, avisos, seleção segura e reenvio de arquivo sem nova IA.
  Nenhuma movimentação de teste foi escrita no banco conectado.
- Testes SQL usam PostgreSQL isolado (PGlite). A trava foi verificada por estado e
  repetição; não foi executado ensaio de carga concorrente com múltiplas conexões.
- Não havia prints financeiros reais disponíveis. A qualidade da visão da IA
  ainda precisa de conferência com seus próprios prints; não há taxa de acerto
  medida nem promessa de eliminar toda duplicação sem revisão humana.

## Conferência do usuário

1. Abra Parcelas, cadastre uma compra real e confira total, parcelas e faturas.
2. Confira o progresso após quitar uma fatura pelo fluxo existente.
3. Importe um print legível; compare cada linha com a imagem original.
4. Reenvie o mesmo arquivo: a revisão existente deve abrir sem nova leitura.
5. Confira um print sobreposto: compare o aviso antes de vincular ou manter outro evento.
6. Ajuste a referência ao usar Hoje/Ontem em um print antigo. Campos cortados devem
   exigir correção, nunca aparecer preenchidos por suposição.
7. Use Guardar revisão e recarregue a página para confirmar a persistência.

## Retorno seguro

Se necessário, suspender novos envios e reverter o frontend pelo GitHub. Preservar
as colunas, FKs e recibos aditivos do banco. Não apagar recibos para contornar um
aviso: isso remove a memória de importação. Qualquer retirada do esquema exige
exportação e nova migration; migrations já aplicadas não são editadas.

## Uso das ferramentas

Codex executou implementação e testes. GitHub registra checkpoint, mudanças e PR.
Lovable recebe o trabalho pronto para sincronização, verificação do ambiente e
publicação, evitando reconstruir as funcionalidades por chat. Nenhuma economia
numérica de tokens/créditos é presumida.
