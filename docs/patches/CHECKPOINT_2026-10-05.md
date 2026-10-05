# Checkpoint: seleção de cartão no importador
Base GitHub/Lovable: d51f1a5183deb5acfd231ef373749bdbd5ca0717.
Branch: feat/cartao-principal-20261005.
Autorização: implementar, validar, sincronizar banco/GitHub/Lovable e publicar.
Codex: código/testes. GitHub: commits e checkpoint. Lovable: banco/sincronização/publicação.
Regra: escolha manual > final único do print > cartão único > principal. Evidência conflitante exige seleção.
Persistência: profiles.primary_card_id (FK), opção Agora não, credit_cards.last_four, origem em candidato/recibo OCR.
Estado: código validado; 48 verificações, tipos, ESLint e build passaram.
Próxima ação: aplicar migration em transação, integrar PR e conferir sincronização/publicação.
