
-- Handbook Expand Architecture: Add basis/expand content separation to handbook_sections
ALTER TABLE public.handbook_sections
ADD COLUMN IF NOT EXISTS basis_content text,
ADD COLUMN IF NOT EXISTS expanded_content text,
ADD COLUMN IF NOT EXISTS content_tier text DEFAULT 'basis',
ADD COLUMN IF NOT EXISTS basis_generated_at timestamptz,
ADD COLUMN IF NOT EXISTS expanded_at timestamptz,
ADD COLUMN IF NOT EXISTS expand_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS expand_attempts int DEFAULT 0,
ADD COLUMN IF NOT EXISTS expand_last_error text,
ADD COLUMN IF NOT EXISTS expand_provider text,
ADD COLUMN IF NOT EXISTS expand_model text,
ADD COLUMN IF NOT EXISTS quality_score numeric,
ADD COLUMN IF NOT EXISTS depth_markers jsonb DEFAULT '{}'::jsonb;

-- Index for expand job queries
CREATE INDEX IF NOT EXISTS idx_handbook_sections_expand_status 
ON public.handbook_sections (expand_status) 
WHERE expand_status IN ('pending', 'expanding');
