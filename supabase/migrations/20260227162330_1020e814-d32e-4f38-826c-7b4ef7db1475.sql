
DROP FUNCTION IF EXISTS public.ops_cancel_pending_non_building_jobs();

CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.job_queue jq
  SET status = 'failed',
      updated_at = now(),
      last_error = coalesce(jq.last_error,'') || ' | OPS_GUARD:NON_BUILDING_PACKAGE',
      meta = coalesce(jq.meta,'{}'::jsonb) || jsonb_build_object(
        'ops_guard', true,
        'ops_guard_reason', 'NON_BUILDING_PACKAGE',
        'ops_guard_at', now()
      )
  FROM public.course_packages cp
  WHERE jq.status = 'pending'
    AND (cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id'))
    AND cp.status <> 'building';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO public.ops_alert_events (alert_key, severity, summary, details)
    VALUES (
      'NON_BUILDING_PENDING_CLEANUP',
      CASE WHEN v_count >= 10 THEN 'warn' ELSE 'info' END,
      format('Auto-failed %s pending jobs on non-building packages', v_count),
      jsonb_build_object('count', v_count, 'cleaned_at', now())
    );
  END IF;

  RETURN jsonb_build_object('cleaned', v_count);
END;
$$;
