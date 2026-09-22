# Checkpoint: Parcelas e importador por print

Base: `ad92d5b504ab17e88f4e6747108092c1cffe847d` (GitHub e Lovable iguais).
Branch: `feat/parcelas-importador-20260922`.
Autorização: executar as duas funcionalidades aprovadas, validar, sincronizar e entregar o patch.

## Escopo aprovado

- Parcelas: área própria, separada de Assinaturas, baseada em `credit_card_bill_items`.
- Acompanhamento por compra, cartão, valores, parcelas pagas/pendentes/vencidas e projeção mensal.
- Preservar o regime financeiro da Visão Geral e o pagamento pelas Faturas.
- Importação por print totalmente independente de Parcelas.
- Prompt versionado, leitura completa, evidência por item, datas Hoje/Ontem com referência ajustável.
- Revisão persistente; arquivo repetido reaproveita a sessão; gravação atômica e idempotente.
- Duplicidade provável exige comparação e decisão. Sem excluir compras legítimas por coincidência de valor/data.
- PK/FK/UNIQUE no banco; cache somente para desempenho.

## Divisão do trabalho

1. Codex: migrations incrementais, regras, UI, testes e documentação.
2. GitHub: commits por intenção, branch, PR e registro permanente do patch.
3. Lovable: conferência do ambiente, aplicação do banco e verificação/publicação da versão sincronizada.

## Estado inicial verificado

- Banco Lovable habilitado (Supabase).
- Parcelas já existem no cadastro manual e no ledger de faturas.
- OCR atual protege a repetição de salvamento do mesmo item, mas não identifica arquivos repetidos.
- Banco consultado sem transações, compras parceladas ou prints cadastrados no início desta atualização.
- Validação de qualidade visual da IA usará casos controlados. Não há prints reais disponíveis neste ambiente para medir acurácia real.

## Próximas etapas

Implementar em commits separados, executar testes de PostgreSQL isolado (PGlite), tipos/build,
conferir desktop/mobile, sincronizar migrations e registrar os resultados no patch final.
