# Micro patch: cartão no importador de prints

Data: 05/10/2026. Base: d51f1a5183deb5acfd231ef373749bdbd5ca0717.
Projeto: VictorFurushima/furushimafinanceiro, Lovable ec051308-bc31-4b3a-854d-14e500a89183.

## Problema e comportamento

O campo Cartão exigia confirmação mesmo com um único cartão cadastrado.
Agora o importador resolve a seleção ao carregar os cartões, antes de salvar.

1. Escolha manual válida permanece.
2. Um final identificado de forma única seleciona o cartão correspondente.
3. Com um único cartão ativo, ele fica pré-selecionado.
4. Com vários cartões e sem identificação, usa o principal, se definido.
5. Com vários cartões e sem principal, oferece Definir cartão principal e Agora não.
6. Sem cartões ativos, informa a situação e oferece acesso ao cadastro.

Dígitos conflitantes, dois cartões com o mesmo final ou vários finais no print
exigem seleção manual. A exceção ao cartão único protege contra atribuir uma
compra de outro cartão. Se o cartão único não tem final cadastrado, a seleção
usa a regra de cartão único. Não deduz cartão pelo banco, marca, data ou valor.

A seleção automática não acrescenta uma confirmação. Os avisos de OCR de baixa
confiança e as decisões sobre possíveis duplicatas continuam exigindo revisão.
Um texto discreto informa a origem da seleção. O usuário consegue trocar o cartão.

## Preferência e cadastro

O principal é configurável em Cartões de Crédito e na oferta do importador.
Agora não persiste no perfil para evitar repetir a oferta a cada visita.
A preferência continua disponível na página de cartões.
O cadastro aceita os quatro últimos dígitos, opcionalmente. Não armazena o número completo.
Cartões inativos não entram na seleção automática. Cartões de outro titular não
entram na resolução nem são aceitos como principal pelo banco.

## Banco

Migration incremental: 20261005163000_ocr_card_selection.sql.
Nenhuma migration anterior foi alterada. Nenhuma movimentação existente recebe backfill.

- credit_cards.last_four: texto opcional com exatamente quatro dígitos.
- profiles.primary_card_id: FK para credit_cards.id, ON DELETE SET NULL.
- profiles.primary_card_prompt_dismissed: escolha de adiar a oferta.
- Trigger valida cartão ativo pertencente ao titular do perfil.
- ocr_detected_transactions.card_selection_source: origem da seleção na revisão.
- ocr_import_receipts.card_selection_source: origem preservada no recibo durável.
- save_ocr_review grava a origem junto com a transação e o recibo, atomicamente.

Origens: ocr_match, single_card, primary_card e manual.
As políticas RLS permanecem. As RPCs continuam SECURITY INVOKER.
Preferência por usuário tem cache próprio. A seleção local é recalculada com os
dados carregados, preservando alterações manuais e sem chamadas adicionais de IA.
Parcelas usa seu fluxo existente. Este patch altera apenas a resolução do cartão no OCR.

## Validação

48 verificações: 29 do importador/parcelas e 19 do ledger financeiro.
Incluem zero/um/vários cartões, principal, seleção manual, cartão inativo, finais
ambíguos, carregamento assíncrono, alertas OCR, propriedade, exclusão do principal,
validação dos quatro dígitos, rastreabilidade, idempotência e duplicatas.
TypeScript, ESLint dos arquivos alterados, git diff --check e build de produção passaram.

Um teste antigo misturava uma entrada com CURRENT_DATE e uma consulta fixa de
setembro de 2026. A mudança de mês expôs o problema. A data da entrada no teste
foi fixada em 04/09/2026 para manter o cenário determinístico. Nenhuma regra do
ledger foi alterada para resolver esse teste.

O print enviado orientou o cenário XP final 5461. Não foi necessário executar
novamente a IA de OCR nem criar movimentações de teste no banco de produção.
Não foi realizado teste visual autenticado ponta a ponta nesta sessão.

## Implantação

PR #5 integrado: https://github.com/VictorFurushima/furushimafinanceiro/pull/5.
Versão funcional: 9ace7be8f334100923af86b6d334ed30d98495de.
GitHub e Lovable confirmaram esse SHA. A árvore enviada correspondeu exatamente
à árvore do código local testado: 36f2c392c8dac5b16a2c60b5d9e6aa4fad19cc04.

A migration foi aplicada em uma transação e registrada em schema_migrations.
Conferência no banco: cinco novas colunas, FK com SET NULL, trigger de titular
instalado e save_ocr_review SECURITY INVOKER com gravação da origem.
O banco tinha um cartão ativo, sem alterar seus dados nem criar transações.

A publicação inicialmente retornou pending, deployment
43321ab9-4bae-4605-8f43-545c2cc116ce. A confirmação por chat ficou na fila
por server_error. A checagem direta resolveu a verificação: a URL pública
respondeu HTTP 200 e passou a servir os bundles novos, incluindo
import-prints-DRjTgXQi.js e card-preference-O5x7hlzX.js.
Foram conferidos nos arquivos públicos a seleção automática, identificação pelo
print, origens de seleção, oferta do principal, Agora não e campos persistidos.
A publicação do código do patch foi confirmada pelos arquivos servidos.
Não houve teste autenticado de interação ou gravação pelo navegador.

Nenhuma nova implementação foi solicitada ao chat Lovable: apenas uma mensagem
curta de conferência, em modo de planejamento, sem edição de código.

## Conferência pelo usuário

Abra Importar por Print e revise o lançamento já existente. Com seu cartão único,
o campo Cartão deve estar preenchido e permitir salvar sem selecionar o cartão.
Em Cartões de Crédito, edite os últimos quatro dígitos se desejar identificação
por print ao adicionar outros cartões. O principal funciona para prints sem final identificado.

## Otimização e rollback

Codex realizou implementação e validação. GitHub conserva o patch e o checkpoint.
Lovable recebe código pronto por sincronização e usa operações de banco/publicação,
sem refazer a implementação por conversa. Não se presume economia numérica de tokens.

Para reverter a interface, reverta os commits do frontend. As novas colunas são
opcionais e compatíveis com a versão anterior. Para retirar o banco, restaure
save_ocr_review da migration de 22/09, exporte as origens e remova o trigger,
a FK e as colunas. Não exclua transações nem recibos para reverter este patch.
