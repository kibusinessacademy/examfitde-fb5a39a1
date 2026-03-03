-- Backup raw values for forensics
ALTER TABLE public.berufe
  ADD COLUMN IF NOT EXISTS taetigkeitsprofil_raw text;

UPDATE public.berufe
SET taetigkeitsprofil_raw = taetigkeitsprofil
WHERE taetigkeitsprofil IS NOT NULL
  AND taetigkeitsprofil_raw IS NULL;

-- Safe public view (SSOT for UI/SEO)
CREATE OR REPLACE VIEW public.v_berufe_public_safe AS
SELECT
  b.*,
  CASE
    WHEN b.taetigkeitsprofil IS NULL THEN NULL
    WHEN b.taetigkeitsprofil ~ 'sp[0-9]+S[0-9]+' THEN NULL
    WHEN LENGTH(TRIM(b.taetigkeitsprofil)) < 25 THEN NULL
    ELSE b.taetigkeitsprofil
  END AS taetigkeitsprofil_safe
FROM public.berufe b;