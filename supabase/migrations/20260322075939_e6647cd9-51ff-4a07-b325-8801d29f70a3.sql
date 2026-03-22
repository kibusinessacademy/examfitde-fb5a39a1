
-- ============================================================
-- 1. Harden claim_content_jobs: atomic claim with worker_id + claimed_at
-- ============================================================
DROP FUNCTION IF EXISTS public.claim_content_jobs(INTEGER, TEXT);

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
      updated_at = now(),
      generation_meta = jsonb_set(
        COALESCE(generation_meta, '{}'::jsonb),
        '{worker_id}',
        to_jsonb(p_worker_id)
      ) || jsonb_build_object('claimed_at', to_jsonb(now()::text))
  WHERE id IN (
    SELECT id FROM public.content_jobs
    WHERE status = 'queued'
      AND attempt_count < 3
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ============================================================
-- 2. Balanced hook selection: least-used first, then random from top N
-- ============================================================
CREATE OR REPLACE FUNCTION public.pick_content_hook(
  p_category TEXT,
  p_pool_size INTEGER DEFAULT 5
)
RETURNS TABLE(id UUID, hook_text TEXT, category TEXT, usage_count INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.id, h.hook_text, h.category, h.usage_count
  FROM public.content_hooks h
  WHERE h.is_active = true
    AND h.category = p_category
  ORDER BY h.usage_count ASC, random()
  LIMIT p_pool_size;
$$;
