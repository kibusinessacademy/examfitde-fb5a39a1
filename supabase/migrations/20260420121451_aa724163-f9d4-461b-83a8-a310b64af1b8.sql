-- 1) RPC mit Whitelist-Respekt
CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    JOIN public.course_packages cp
      ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND cp.status NOT IN ('building', 'quality_gate_failed', 'blocked', 'council_review')
      AND NOT COALESCE(jtp.can_run_when_not_building, false)
      AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
    LIMIT 500
  )
  UPDATE public.job_queue jq
  SET status = 'failed',
      updated_at = now(),
      last_error = coalesce(jq.last_error,'') || ' | OPS_GUARD:NON_BUILDING_PACKAGE',
      meta = coalesce(jq.meta,'{}'::jsonb) || jsonb_build_object(
        'ops_guard', true,
        'ops_guard_reason', 'NON_BUILDING_PACKAGE',
        'ops_guard_at', now()
      )
  FROM picked
  WHERE jq.id = picked.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    PERFORM public.ops_raise_alert(
      'NON_BUILDING_PENDING_CLEANUP',
      CASE WHEN v_count >= 10 THEN 'warn' ELSE 'info' END,
      format('Auto-failed %s pending jobs on non-building packages', v_count),
      jsonb_build_object('count', v_count, 'cleaned_at_bucket', date_trunc('hour', now()))
    );
  END IF;

  RETURN v_count;
END;
$function$;

-- 2) Trigger mit Whitelist-Respekt
CREATE OR REPLACE FUNCTION public.fn_guard_non_building_auto_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _whitelisted boolean;
BEGIN
  SELECT COALESCE(can_run_when_not_building, false) OR COALESCE(exempt_from_auto_cancel, false)
    INTO _whitelisted
  FROM public.job_type_policies
  WHERE job_type = NEW.job_type;

  IF COALESCE(_whitelisted, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'pending'
     AND NEW.error IS NOT NULL
     AND NEW.error ILIKE '%NON_BUILDING_PACKAGE%'
  THEN
    NEW.status := 'cancelled';
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Re-Enqueue idempotent (curriculum_id aus course_packages)
INSERT INTO public.job_queue (
  job_type, status, package_id, payload, worker_pool, priority, meta
)
SELECT
  'package_auto_generate_seo_suite',
  'pending',
  src.package_id,
  jsonb_build_object(
    'package_id', src.package_id,
    'curriculum_id', cp.curriculum_id,
    'reason', 'whitelist_replay_post_publish_seo_suite'
  ),
  'marketing',
  50,
  jsonb_build_object(
    'source', 'whitelist_replay_2026_04_20',
    'reason', 'reenqueued_after_guard_fix'
  )
FROM (
  SELECT DISTINCT jq.package_id
  FROM public.job_queue jq
  JOIN public.course_packages cp ON cp.id = jq.package_id
  WHERE jq.job_type = 'package_auto_generate_seo_suite'
    AND jq.status = 'cancelled'
    AND cp.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq2
      WHERE jq2.job_type = 'package_auto_generate_seo_suite'
        AND jq2.package_id = jq.package_id
        AND jq2.status IN ('pending','processing','completed')
    )
) src
JOIN public.course_packages cp ON cp.id = src.package_id;

-- 4) Audit-Marker auf alten Cancels
UPDATE public.job_queue
SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
  'replayed_by_whitelist_fix', true,
  'replayed_at', now()::text
)
WHERE job_type = 'package_auto_generate_seo_suite'
  AND status = 'cancelled'
  AND (meta->>'replayed_by_whitelist_fix') IS NULL;