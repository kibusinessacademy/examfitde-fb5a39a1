ALTER TABLE public.handbook_sections
  ADD COLUMN IF NOT EXISTS verification_score integer,
  ADD COLUMN IF NOT EXISTS verification_missing text[],
  ADD COLUMN IF NOT EXISTS verification_markers jsonb,
  ADD COLUMN IF NOT EXISTS verification_version integer DEFAULT 1;