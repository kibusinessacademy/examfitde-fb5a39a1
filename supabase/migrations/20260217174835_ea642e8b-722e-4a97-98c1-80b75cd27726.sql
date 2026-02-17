-- Add IHK weighting & exam part columns to learning_fields
ALTER TABLE public.learning_fields
  ADD COLUMN IF NOT EXISTS weight_percent NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exam_part TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS difficulty_tier TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS ihk_focus_areas JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.learning_fields.weight_percent IS 'IHK-Prüfungsgewichtung in Prozent (Summe aller LF eines Curriculums = 100)';
COMMENT ON COLUMN public.learning_fields.exam_part IS 'Prüfungsteil: teil_1, teil_2, or both';
COMMENT ON COLUMN public.learning_fields.difficulty_tier IS 'Schwierigkeitsstufe: easy, medium, hard';
COMMENT ON COLUMN public.learning_fields.ihk_focus_areas IS 'IHK-Schwerpunktbereiche als JSON-Array';