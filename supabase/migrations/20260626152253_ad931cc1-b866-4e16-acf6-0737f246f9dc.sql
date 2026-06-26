
-- Re-Audit RPC for stuck 'done' packages — drives integrity + council + auto-publish enqueue.
CREATE OR REPLACE FUNCTION public.enqueue_done_reaudit(
  p_cap integer DEFAULT 100,
  p_reason text DEFAULT 'done_reaudit_cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cap int := GREATEST(5, LEAST(COALESCE(p_cap,100), 500));
  v_src text := COALESCE(NULLIF(p_reason,''),'done_reaudit_cron');
  v_integ int := 0;
  v_council int := 0;
  v_publish int := 0;
  v_skipped_bronze int := 0;
  v_eligible int := 0;
BEGIN
  WITH base AS (
    SELECT cp.id, cp.curriculum_id,
      COALESCE(cp.integrity_passed,false) AS integ_ok,
      COALESCE(cp.council_approved,false) AS council_ok,
      COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean,false)
        OR COALESCE(cp.feature_flags->'bronze'->>'final_state','') IN ('requires_review','manual_approved')
        AS is_bronze_locked
    FROM public.course_packages cp
    WHERE cp.status = 'done'
      AND cp.published_at IS NULL
    ORDER BY cp.updated_at ASC
    LIMIT v_cap
  ),
  flt AS (
    SELECT * FROM base WHERE NOT is_bronze_locked
  ),
  -- Enqueue integrity re-check where missing
  ins_integ AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT 'package_run_integrity_check', 'pending',
      jsonb_build_object('package_id', f.id::text, 'curriculum_id', f.curriculum_id::text,
                         'reason', p_reason, 'enqueue_source', v_src),
      f.id, 'core', 65, 3
    FROM flt f
    WHERE NOT f.integ_ok
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'package_run_integrity_check'
          AND jq.status IN ('pending','queued','processing','running')
          AND jq.package_id = f.id
      )
    RETURNING 1
  ),
  -- Enqueue council re-run where missing
  ins_council AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT 'package_quality_council', 'pending',
      jsonb_build_object('package_id', f.id::text, 'curriculum_id', f.curriculum_id::text,
                         'reason', p_reason, 'enqueue_source', v_src),
      f.id, 'core', 66, 3
    FROM flt f
    WHERE NOT f.council_ok
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'package_quality_council'
          AND jq.status IN ('pending','queued','processing','running')
          AND jq.package_id = f.id
      )
    RETURNING 1
  ),
  -- Both gates green but unpublished → drive auto-publish
  ins_publish AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT 'package_auto_publish', 'pending',
      jsonb_build_object('package_id', f.id::text, 'curriculum_id', f.curriculum_id::text,
                         'reason', p_reason, 'enqueue_source', v_src),
      f.id, 'core', 60, 3
    FROM flt f
    WHERE f.integ_ok AND f.council_ok
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'package_auto_publish'
          AND jq.status IN ('pending','queued','processing','running')
          AND jq.package_id = f.id
      )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM flt),
    (SELECT COUNT(*) FROM base WHERE is_bronze_locked),
    (SELECT COUNT(*) FROM ins_integ),
    (SELECT COUNT(*) FROM ins_council),
    (SELECT COUNT(*) FROM ins_publish)
  INTO v_eligible, v_skipped_bronze, v_integ, v_council, v_publish;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('done_reaudit_cron_run', v_src, 'system', 'batch', 'ok',
    format('eligible=%s integ=%s council=%s publish=%s skip_bronze=%s', v_eligible, v_integ, v_council, v_publish, v_skipped_bronze),
    jsonb_build_object('cap', v_cap, 'enqueue_source', v_src));

  RETURN jsonb_build_object(
    'cap', v_cap,
    'eligible', v_eligible,
    'enqueued_integrity', v_integ,
    'enqueued_council', v_council,
    'enqueued_publish', v_publish,
    'skipped_bronze_locked', v_skipped_bronze,
    'enqueue_source', v_src
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_done_reaudit(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_done_reaudit(integer, text) TO service_role;
