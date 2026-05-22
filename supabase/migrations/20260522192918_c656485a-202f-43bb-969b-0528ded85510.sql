
-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('transaction-prints', 'transaction-prints', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "users read own prints"
ON storage.objects FOR SELECT
USING (bucket_id = 'transaction-prints' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users upload own prints"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'transaction-prints' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users delete own prints"
ON storage.objects FOR DELETE
USING (bucket_id = 'transaction-prints' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Uploaded images
CREATE TABLE public.uploaded_transaction_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  image_url text,
  processing_status text NOT NULL DEFAULT 'pending',
  ocr_confidence text,
  delete_after_processing boolean NOT NULL DEFAULT false,
  error_message text,
  upload_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.uploaded_transaction_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prints owner all"
ON public.uploaded_transaction_images FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- OCR detected transactions
CREATE TABLE public.ocr_detected_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  image_id uuid NOT NULL REFERENCES public.uploaded_transaction_images(id) ON DELETE CASCADE,
  detected_date date,
  detected_amount numeric,
  detected_type text,
  detected_description text,
  detected_payment_method text,
  detected_account text,
  suggested_category text,
  suggested_category_id uuid,
  confidence_level text DEFAULT 'media',
  review_status text NOT NULL DEFAULT 'pending',
  possible_duplicate boolean NOT NULL DEFAULT false,
  saved_transaction_id uuid,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ocr_detected_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ocr tx owner all"
ON public.ocr_detected_transactions FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ocr_tx_image ON public.ocr_detected_transactions(image_id);
CREATE INDEX idx_ocr_tx_user ON public.ocr_detected_transactions(user_id);
