# Checkpoint: seleção de cartão no importador
Base GitHub/Lovable: d51f1a5183deb5acfd231ef373749bdbd5ca0717.
Branch: feat/cartao-principal-20261005.
Autorização: implementar, validar, sincronizar banco/GitHub/Lovable e publicar.
Codex: código/testes. GitHub: commits e checkpoint. Lovable: banco/sincronização/publicação.
Regra: escolha manual > final único do print > cartão único > principal. Evidência conflitante exige seleção.
Persistência: profiles.primary_card_id (FK), opção Agora não, credit_cards.last_four, origem em candidato/recibo OCR.
Estado: concluído. 48 verificações, tipos, ESLint e build passaram.
DB: migration 20261005163000 aplicada e conferida.
GitHub: PR #5 integrado; versão funcional 9ace7be8f334100923af86b6d334ed30d98495de.
Lovable: SHA sincronizado, publicação confirmada pela URL HTTP 200 e bundles novos.
Mensagem de conferência em plan_mode ficou pausada por server_error; nenhum código solicitado.
Validação pendente do usuário: interação autenticada com o lançamento real.
Próxima ação: nenhuma implementação pendente neste escopo. Conferir o uso no site.
