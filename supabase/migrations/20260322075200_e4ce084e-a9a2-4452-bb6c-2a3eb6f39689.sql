
-- ============================================================
-- Harden content_jobs: Worker model + SSOT Governance + Audit
-- ============================================================

-- Expand status model (needs_review, publish_queued, archived)
ALTER TABLE public.content_jobs DROP CONSTRAINT IF EXISTS content_jobs_status_check;
ALTER TABLE public.content_jobs ADD CONSTRAINT content_jobs_status_check 
  CHECK (status IN ('queued', 'running', 'generated', 'needs_review', 'approved', 'publish_queued', 'published', 'failed', 'archived'));

-- Add governance + audit columns
ALTER TABLE public.content_jobs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'question' CHECK (source_type IN ('question', 'blueprint', 'manual')),
  ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_meta JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hook_id UUID REFERENCES public.content_hooks(id) ON DELETE SET NULL;

-- Index for worker claiming
CREATE INDEX IF NOT EXISTS idx_content_jobs_worker_claim 
  ON public.content_jobs(status, created_at) WHERE status IN ('queued', 'running');

-- ============================================================
-- Harden content_performance: Full funnel metrics
-- ============================================================
ALTER TABLE public.content_performance
  ADD COLUMN IF NOT EXISTS avg_watch_time_seconds NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_visits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS link_clicks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_starts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_completions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_count INTEGER DEFAULT 0;

-- ============================================================
-- content_hooks: increment_usage RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_content_hook_usage(p_hook_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.content_hooks 
  SET usage_count = usage_count + 1 
  WHERE id = p_hook_id;
$$;

-- ============================================================
-- claim_content_jobs: Worker claiming RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_content_jobs(
  p_limit INTEGER DEFAULT 5,
  p_worker_id TEXT DEFAULT 'content-worker'
)
RETURNS SETOF public.content_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.content_jobs
  SET status = 'running',
      updated_at = now()
  WHERE id IN (
    SELECT id FROM public.content_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
