
-- 1) Observability table for cron run logging
CREATE TABLE IF NOT EXISTS public.system_cron_runs (
  id bigserial PRIMARY KEY,
  job_name text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Hardened enqueue RPC: dedupe includes 'enqueued', legacy_report filter
CREATE OR REPLACE FUNCTION public.enqueue_integrity_rechecks(p_cap int DEFAULT 150, p_reason text DEFAULT 'nightly_backfill')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int := GREATEST(10, LEAST(COALESCE(p_cap,150), 500));
  v_inserted int := 0;
  v_candidates int := 0;
BEGIN
  WITH candidates AS (
    SELECT cp.id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE
      cp.integrity_report IS NULL
      OR (
        (cp.integrity_report->>'legacy_report') IS DISTINCT FROM 'true'
        AND (
          cp.integrity_report::text LIKE '%/500%'
          OR cp.integrity_report::text LIKE '%<40\%%'
        )
      )
      OR (cp.status = 'quality_gate_failed' AND cp.track = 'EXAM_FIRST')
    ORDER BY cp.updated_at DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT
      'package_run_integrity_check',
      'pending',
      jsonb_build_object(
        'packageId', c.id::text,
        'curriculum_id', c.curriculum_id::text,
        'reason', p_reason
      ),
      c.id,
      'core',
      70,
      3
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
      WHERE jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending', 'processing', 'enqueued')
        AND jq.payload->>'packageId' = c.id::text
    )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM candidates),
    (SELECT COUNT(*) FROM ins)
  INTO v_candidates, v_inserted;

  RETURN jsonb_build_object(
    'cap', v_cap,
    'candidates', v_candidates,
    'enqueued', v_inserted
  );
END;
$$;
