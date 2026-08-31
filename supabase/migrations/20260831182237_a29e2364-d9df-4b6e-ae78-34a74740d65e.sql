-- Objetivo: acelerar a consulta da tela Importar por Print, que lista apenas
-- transações detectadas ainda não salvas/ignoradas, por usuário, ordenadas por created_at desc.
-- Tabela afetada: public.ocr_detected_transactions (somente índice).
-- Impacto de dados: nenhum. RLS: inalterada. Rollback: DROP INDEX idx_ocr_pending_review.
CREATE INDEX IF NOT EXISTS idx_ocr_pending_review
  ON public.ocr_detected_transactions (user_id, created_at DESC)
  WHERE review_status IN ('pending', 'needs_review');