
-- 1) SSOT: forbidden index names table
CREATE TABLE IF NOT EXISTS public.forbidden_db_indexes (
  index_name text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.forbidden_db_indexes (index_name, reason)
VALUES
  ('uq_jobqueue_curriculum_jobtype_scope_active', 'Throughput bottleneck: caps lesson_generate_content to 1 active job per curriculum. Keep lesson+step idempotency instead.'),
  ('uq_jobqueue_package_jobtype_scope_active',    'Throughput bottleneck: caps lesson_generate_content to 1 active job per package. Keep lesson+step idempotency instead.'),
  ('idx_job_queue_pipeline_idempotency_scope',    'Over-broad idempotency scope can throttle concurrency. Use lesson+step partial unique index.')
ON CONFLICT (index_name) DO NOTHING;

-- 2) RPC: check forbidden indexes
CREATE OR REPLACE FUNCTION public.guard_forbidden_indexes()
RETURNS TABLE (
  verdict text,
  forbidden_found jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found jsonb;
  v_verdict text;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'index_name', i.indexname,
        'table', i.tablename,
        'def', i.indexdef
      )
    ),
    '[]'::jsonb
  )
  INTO found
  FROM pg_indexes i
  JOIN public.forbidden_db_indexes f
    ON f.index_name = i.indexname
  WHERE i.schemaname = 'public';

  IF jsonb_array_length(found) > 0 THEN
    v_verdict := 'fail';
  ELSE
    v_verdict := 'pass';
  END IF;

  verdict := v_verdict;
  forbidden_found := found;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.guard_forbidden_indexes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_forbidden_indexes() TO service_role;

-- 3) Ensure lesson+step active uniqueness index exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='uq_job_queue_active_lesson_step'
  ) THEN
    EXECUTE $DDL$
      CREATE UNIQUE INDEX uq_job_queue_active_lesson_step
      ON public.job_queue (
        job_type,
        (payload->>'lesson_id'),
        (payload->>'step_key')
      )
      WHERE status IN ('pending','queued','processing')
    $DDL$;
  END IF;
END $$;

-- 4) Accelerate runner scans for lesson_generate_content
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_job_queue_lesson_generate_content_active'
  ) THEN
    EXECUTE $DDL$
      CREATE INDEX idx_job_queue_lesson_generate_content_active
      ON public.job_queue (created_at)
      WHERE job_type='lesson_generate_content' AND status IN ('pending','queued','processing')
    $DDL$;
  END IF;
END $$;
