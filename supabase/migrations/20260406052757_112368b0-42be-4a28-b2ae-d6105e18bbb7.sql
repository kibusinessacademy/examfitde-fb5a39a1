-- Add hardening columns to curriculum_discovery
ALTER TABLE public.curriculum_discovery
  ADD COLUMN IF NOT EXISTS canonical_slug text,
  ADD COLUMN IF NOT EXISTS collision_check jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Generate canonical_slug for existing rows
UPDATE public.curriculum_discovery
SET canonical_slug = lower(regexp_replace(
  regexp_replace(title, '[^a-zA-ZäöüÄÖÜß0-9§ ]', '', 'g'),
  '\s+', '-', 'g'
)) || ':' || coalesce(source, 'unknown') || ':' || coalesce(year::text, '0000')
WHERE canonical_slug IS NULL;

-- Unique index on canonical_slug for robust dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_canonical_slug
  ON public.curriculum_discovery (canonical_slug);

-- Performance index for cron queries
CREATE INDEX IF NOT EXISTS idx_discovery_status_score
  ON public.curriculum_discovery (status, score DESC);

-- Status constraint for valid workflow states
ALTER TABLE public.curriculum_discovery
  DROP CONSTRAINT IF EXISTS chk_discovery_status;
ALTER TABLE public.curriculum_discovery
  ADD CONSTRAINT chk_discovery_status
  CHECK (status IN ('detected', 'evaluated', 'manual_hold', 'approved', 'rejected', 'built'));