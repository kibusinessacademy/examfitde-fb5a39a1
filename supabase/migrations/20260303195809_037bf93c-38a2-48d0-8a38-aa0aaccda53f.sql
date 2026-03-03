-- 1) Mark legacy reports for forensic clarity
CREATE OR REPLACE FUNCTION public.mark_legacy_integrity_reports()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.course_packages
  SET integrity_report = jsonb_set(
    COALESCE(integrity_report, '{}'::jsonb),
    '{legacy_report}',
    'true'::jsonb,
    true
  )
  WHERE integrity_report IS NOT NULL
    AND (integrity_report->>'legacy_report') IS DISTINCT FROM 'true'
    AND (
      integrity_report::text LIKE '%/500%'
      OR integrity_report::text LIKE '%<40\%%'
    );
$$;

-- 2) Enqueue integrity re-check jobs (rate-limited + deduped)
-- Must include curriculum_id in payload (guard_job_payload requirement)
CREATE OR REPLACE FUNCTION public.enqueue_integrity_rechecks(
  p_cap int DEFAULT 150,
  p_reason text DEFAULT 'nightly_backfill'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int := GREATEST(10, LEAST(COALESCE(p_cap, 150), 500));
  v_candidates int := 0;
  v_inserted int := 0;
BEGIN
  WITH candidates AS (
    SELECT cp.id, cp.curriculum_id, cp.course_id
    FROM public.course_packages cp
    WHERE cp.curriculum_id IS NOT NULL
      AND (
        cp.integrity_report IS NULL
        OR cp.integrity_report::text LIKE '%/500%'
        OR cp.integrity_report::text LIKE '%<40\%%'
        OR (cp.status = 'quality_gate_failed' AND cp.track = 'EXAM_FIRST')
      )
    ORDER BY cp.updated_at DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, status, payload, priority, max_attempts, package_id, worker_pool)
    SELECT
      'package_run_integrity_check',
      'pending',
      jsonb_build_object(
        'packageId', c.id::text,
        'package_id', c.id::text,
        'curriculum_id', c.curriculum_id::text,
        'course_id', c.course_id::text,
        'reason', p_reason
      ),
      70,
      3,
      c.id,
      'core'
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
      WHERE jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending', 'processing')
        AND (jq.package_id = c.id OR jq.payload->>'packageId' = c.id::text)
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
    'enqueued', v_inserted,
    'reason', p_reason,
    'ts', now()
  );
END;
$$;