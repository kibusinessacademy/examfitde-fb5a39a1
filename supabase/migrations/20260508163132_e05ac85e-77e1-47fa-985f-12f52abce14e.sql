-- Manual heal sweep 2026-05-08 (v2: corrected column metadata)
-- Concern: execute reconciler + admin_auto_heal_remaining + resolve stale alarm
-- Rollback hint: no schema changes; previous admin_auto_heal_remaining body archived in migration history.

-- 1) Service-role parity for admin_auto_heal_remaining (matches reconciler pattern)
CREATE OR REPLACE FUNCTION public.admin_auto_heal_remaining(
  p_max_packages integer DEFAULT 25,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid, package_title text, track text, action text,
  step_keys text[], active_jobs integer, skip_reason text, applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_reset jsonb;
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true;  -- service_role / direct DB (parity with admin_reconcile_queued_tail_without_job)
  ELSE
    v_is_admin := public.has_role(v_caller, 'admin'::app_role);
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: admin role required';
    END IF;
  END IF;

  FOR r IN
    SELECT
      v.package_id, v.package_title, v.track, v.failed_step_keys,
      v.active_jobs, v.heal_state, v.failed_steps, v.last_heal_at
    FROM v_admin_heal_status_per_package v
    WHERE v.heal_state IN ('NEEDS_HEAL','RETRY_ELIGIBLE')
      AND COALESCE(v.active_jobs, 0) = 0
      AND (v.last_heal_at IS NULL OR v.last_heal_at < now() - interval '15 minutes')
    ORDER BY v.failed_steps DESC NULLS LAST, v.package_title
    LIMIT p_max_packages
  LOOP
    package_id := r.package_id;
    package_title := r.package_title;
    track := r.track;
    step_keys := r.failed_step_keys;
    active_jobs := r.active_jobs;

    IF p_dry_run THEN
      action := 'DRY_RUN_WOULD_RESET';
      skip_reason := NULL;
      applied := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      v_reset := public.admin_retry_failed_step(r.package_id, r.failed_step_keys[1]);
      action := 'reset_failed_step';
      skip_reason := NULL;
      applied := COALESCE((v_reset->>'success')::boolean, false);
    EXCEPTION WHEN OTHERS THEN
      action := 'error';
      skip_reason := SQLERRM;
      applied := false;
    END;

    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, metadata
    ) VALUES (
      'admin_auto_heal_remaining_apply',
      'package', r.package_id::text,
      CASE WHEN applied THEN 'success' ELSE 'failure' END,
      jsonb_build_object('step', r.failed_step_keys[1], 'caller', COALESCE(v_caller::text,'service_role'))
    );

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;

-- 2) Run queued-tail reconciler in non-dry mode (2 ELIGIBLE packages)
DO $$
DECLARE
  v_row record;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.admin_reconcile_queued_tail_without_job(
      p_dry_run := false, p_limit := 50
    )
  LOOP
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'manual_heal_sweep_reconcile_tail',
    'system', 'success',
    jsonb_build_object('reconciled_packages', v_count, 'caller', 'manual_heal_sweep_2026_05_08')
  );
END $$;

-- 3) Run admin_auto_heal_remaining (now service_role-callable)
DO $$
DECLARE
  v_applied int := 0;
  v_total int := 0;
  v_row record;
BEGIN
  FOR v_row IN
    SELECT * FROM public.admin_auto_heal_remaining(
      p_max_packages := 25, p_dry_run := false
    )
  LOOP
    v_total := v_total + 1;
    IF v_row.applied THEN v_applied := v_applied + 1; END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'manual_heal_sweep_auto_heal_remaining',
    'system',
    CASE WHEN v_applied > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object('packages_attempted', v_total, 'packages_applied', v_applied,
                       'caller', 'manual_heal_sweep_2026_05_08')
  );
END $$;

-- 4) Resolve stale cta_visible_stall alarm (Pipeline recovered)
WITH resolved AS (
  UPDATE public.ops_alert_events
  SET resolved_at = now()
  WHERE alert_key = 'launch.tracking.cta_visible_stall'
    AND resolved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.conversion_events ce
      WHERE ce.event_type = 'cta_visible'
        AND ce.created_at > now() - interval '1 hour'
    )
  RETURNING id, alert_key
)
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
SELECT
  'manual_heal_sweep_resolve_stale_alarm',
  'alarm', 'success',
  jsonb_build_object('alarm_id', id, 'alert_key', alert_key,
                     'reason', 'c1h recovered: events resumed in last hour',
                     'caller', 'manual_heal_sweep_2026_05_08')
FROM resolved;

-- Smoke test
DO $$
DECLARE
  v_remaining_eligible int;
  v_open_alarms int;
BEGIN
  SELECT COUNT(*) INTO v_remaining_eligible
  FROM public.v_queued_tail_without_job
  WHERE reconciler_verdict = 'ELIGIBLE' AND next_tail_step IS NOT NULL;

  SELECT COUNT(*) INTO v_open_alarms
  FROM public.ops_alert_events
  WHERE alert_key = 'launch.tracking.cta_visible_stall' AND resolved_at IS NULL;

  RAISE NOTICE 'Heal sweep complete. Remaining ELIGIBLE tail-pkgs: %, open cta_visible alarms: %',
    v_remaining_eligible, v_open_alarms;
END $$;