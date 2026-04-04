
ALTER TABLE public.programs
ADD COLUMN IF NOT EXISTS cluster text,
ADD COLUMN IF NOT EXISTS priority_wave integer,
ADD COLUMN IF NOT EXISTS study_mode text DEFAULT 'dual',
ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS canonical_title text;

COMMENT ON COLUMN public.programs.cluster IS 'Thematic cluster: wirtschaft, it, technik';
COMMENT ON COLUMN public.programs.priority_wave IS 'Rollout wave: 1=core, 2=growth, 3=niche';
COMMENT ON COLUMN public.programs.study_mode IS 'Study mode: dual, vollzeit, berufsbegleitend';
COMMENT ON COLUMN public.programs.aliases IS 'Alternative names for dedup';
COMMENT ON COLUMN public.programs.canonical_title IS 'Clean canonical display title';
