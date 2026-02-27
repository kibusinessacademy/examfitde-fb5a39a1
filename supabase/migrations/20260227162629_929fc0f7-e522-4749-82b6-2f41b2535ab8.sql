
-- Drop and recreate with RETURNS int, dedupe via ops_raise_alert, LIMIT 500 guard
DROP FUNCTION IF EXISTS public.ops_cancel_pending_non_building_jobs();

CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    JOIN public.course_packages cp
      ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
    WHERE jq.status = 'pending'
      AND cp.status <> 'building'
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
      jsonb_build_object(
        'count', v_count,
        'cleaned_at_bucket', date_trunc('hour', now())
      )
    );
  END IF;

  RETURN v_count;
END;
$$;

-- Lock down to service_role only
REVOKE ALL ON FUNCTION public.ops_cancel_pending_non_building_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_cancel_pending_non_building_jobs() FROM anon;
REVOKE ALL ON FUNCTION public.ops_cancel_pending_non_building_jobs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_cancel_pending_non_building_jobs() TO service_role;
