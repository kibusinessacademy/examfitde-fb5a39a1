
CREATE OR REPLACE VIEW public.v_admin_heal_status_per_package AS
WITH heal_agg AS (
  SELECT
    target_id::uuid AS package_id,
    COUNT(*) FILTER (WHERE result_status = 'success')                       AS heals_success,
    COUNT(*) FILTER (WHERE result_status IN ('skipped','skip'))             AS heals_skipped,
    COUNT(*) FILTER (WHERE result_status IN ('failed','error'))             AS heals_failed,
    COUNT(*)                                                                AS heals_total,
    MAX(created_at) FILTER (WHERE result_status = 'success')                AS last_success_at,
    MAX(created_at) FILTER (WHERE result_status IN ('failed','error'))      AS last_failure_at,
    MAX(created_at) FILTER (WHERE result_status IN ('skipped','skip'))      AS last_skip_at,
    MAX(created_at)                                                         AS last_heal_at,
    (ARRAY_AGG(error_message ORDER BY created_at DESC)
       FILTER (WHERE result_status IN ('failed','error','skipped','skip')))[1] AS last_reason,
    (ARRAY_AGG(action_type   ORDER BY created_at DESC))[1]                  AS last_action_type
  FROM public.auto_heal_log
  WHERE target_type = 'package'
    AND created_at > now() - interval '30 days'
  GROUP BY target_id
),
step_agg AS (
  SELECT
    package_id,
    COUNT(*) FILTER (WHERE status = 'failed')                                       AS failed_steps,
    COUNT(*) FILTER (WHERE status = 'queued')                                       AS queued_steps,
    COUNT(*) FILTER (WHERE status = 'running')                                      AS running_steps,
    ARRAY_AGG(step_key ORDER BY updated_at DESC) FILTER (WHERE status = 'failed')   AS failed_step_keys
  FROM public.package_steps
  GROUP BY package_id
),
job_agg AS (
  SELECT
    (payload->>'package_id')::uuid AS package_id,
    COUNT(*) FILTER (WHERE status IN ('queued','processing','running')) AS active_jobs
  FROM public.job_queue
  WHERE payload ? 'package_id'
    AND status IN ('queued','processing','running')
  GROUP BY (payload->>'package_id')::uuid
)
SELECT
  cp.id                                  AS package_id,
  cp.title                               AS package_title,
  cp.track::text                         AS track,
  cp.status                              AS package_status,
  cp.blocked_reason,
  COALESCE(ha.heals_success, 0)          AS heals_success,
  COALESCE(ha.heals_skipped, 0)          AS heals_skipped,
  COALESCE(ha.heals_failed, 0)           AS heals_failed,
  COALESCE(ha.heals_total, 0)            AS heals_total,
  ha.last_heal_at,
  ha.last_success_at,
  ha.last_failure_at,
  ha.last_skip_at,
  ha.last_reason,
  ha.last_action_type,
  COALESCE(sa.failed_steps, 0)           AS failed_steps,
  COALESCE(sa.queued_steps, 0)           AS queued_steps,
  COALESCE(sa.running_steps, 0)          AS running_steps,
  COALESCE(sa.failed_step_keys, ARRAY[]::text[]) AS failed_step_keys,
  COALESCE(ja.active_jobs, 0)            AS active_jobs,
  CASE
    WHEN COALESCE(ja.active_jobs, 0) > 0           THEN 'jobs_running'
    WHEN COALESCE(sa.failed_steps, 0) > 0          THEN 'has_failed_steps'
    WHEN COALESCE(ha.heals_failed, 0) > 0
      AND ha.last_failure_at > COALESCE(ha.last_success_at, '1970-01-01'::timestamptz)
                                                   THEN 'last_heal_failed'
    WHEN COALESCE(ha.heals_success, 0) > 0
      AND cp.status IN ('published','ready')       THEN 'healed'
    WHEN COALESCE(ha.heals_total, 0) = 0           THEN 'no_heal_history'
    ELSE 'pending'
  END AS heal_state
FROM public.course_packages cp
LEFT JOIN heal_agg ha ON ha.package_id = cp.id
LEFT JOIN step_agg sa ON sa.package_id = cp.id
LEFT JOIN job_agg  ja ON ja.package_id = cp.id
WHERE cp.archived IS NOT TRUE;

GRANT SELECT ON public.v_admin_heal_status_per_package TO authenticated;

CREATE OR REPLACE VIEW public.v_admin_heal_status_by_track AS
SELECT
  COALESCE(track, '_unknown_') AS track,
  COUNT(*)                                                AS packages_total,
  COUNT(*) FILTER (WHERE heal_state = 'healed')           AS pkg_healed,
  COUNT(*) FILTER (WHERE heal_state = 'last_heal_failed') AS pkg_failed,
  COUNT(*) FILTER (WHERE heal_state = 'has_failed_steps') AS pkg_with_failed_steps,
  COUNT(*) FILTER (WHERE heal_state = 'jobs_running')     AS pkg_jobs_running,
  COUNT(*) FILTER (WHERE heal_state = 'no_heal_history')  AS pkg_untouched,
  MAX(last_heal_at)                                       AS last_heal_at
FROM public.v_admin_heal_status_per_package
GROUP BY track;

GRANT SELECT ON public.v_admin_heal_status_by_track TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_retry_failed_step(
  p_package_id uuid,
  p_step_key   text,
  p_reason     text DEFAULT 'manual_per_step_retry'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_jobs int;
  v_step_exists boolean;
  v_pkg_status  text;
  v_result      jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT status INTO v_pkg_status FROM public.course_packages WHERE id = p_package_id;
  IF v_pkg_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.package_steps
     WHERE package_id = p_package_id AND step_key = p_step_key
  ) INTO v_step_exists;

  IF NOT v_step_exists THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'step_not_found',
                              'step_key', p_step_key);
  END IF;

  SELECT COUNT(*) INTO v_active_jobs
    FROM public.job_queue
   WHERE status IN ('queued','processing','running')
     AND payload ? 'package_id'
     AND (payload->>'package_id')::uuid = p_package_id
     AND (payload->>'step_key' = p_step_key OR job_type ILIKE '%' || p_step_key || '%');

  IF v_active_jobs > 0 THEN
    INSERT INTO public.auto_heal_log
      (trigger_source, action_type, target_id, target_type,
       input_params, result_status, result_detail, error_message)
    VALUES
      ('admin_ui', 'PER_STEP_RETRY', p_package_id::text, 'package',
       jsonb_build_object('step_key', p_step_key, 'reason', p_reason),
       'skipped', 'jobs_already_running',
       format('Skip: %s active jobs already running for %s', v_active_jobs, p_step_key));

    RETURN jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'jobs_already_running',
      'active_jobs', v_active_jobs, 'step_key', p_step_key
    );
  END IF;

  v_result := public.admin_step_reset_detailed(
    p_package_id  := p_package_id,
    p_step_keys   := ARRAY[p_step_key],
    p_reason      := p_reason,
    p_source      := 'admin_per_step_retry',
    p_nudge_atomic := true
  );

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type,
     input_params, result_status, result_detail)
  VALUES
    ('admin_ui', 'PER_STEP_RETRY', p_package_id::text, 'package',
     jsonb_build_object('step_key', p_step_key, 'reason', p_reason),
     'success', COALESCE(v_result::text, '{}'));

  RETURN jsonb_build_object('ok', true, 'step_key', p_step_key, 'reset_result', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_retry_failed_step(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_auto_heal_remaining(
  p_max_packages int DEFAULT 25,
  p_dry_run      boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid,
  package_title text,
  track text,
  action text,
  step_keys text[],
  active_jobs int,
  skip_reason text,
  applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_reset jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR r IN
    SELECT
      v.package_id, v.package_title, v.track, v.failed_step_keys,
      v.active_jobs, v.heal_state, v.failed_steps, v.last_heal_at
    FROM public.v_admin_heal_status_per_package v
    WHERE v.heal_state IN ('has_failed_steps', 'last_heal_failed')
      AND v.failed_steps > 0
    ORDER BY v.failed_steps DESC, v.last_heal_at NULLS FIRST
    LIMIT GREATEST(p_max_packages, 1)
  LOOP
    IF r.active_jobs > 0 THEN
      package_id    := r.package_id;
      package_title := r.package_title;
      track         := r.track;
      action        := 'skip';
      step_keys     := r.failed_step_keys;
      active_jobs   := r.active_jobs;
      skip_reason   := format('Pipeline-Jobs aktiv (%s) — Auto-Heal pausiert bis Jobs abgeschlossen', r.active_jobs);
      applied       := false;

      IF NOT p_dry_run THEN
        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_id, target_type,
           input_params, result_status, error_message)
        VALUES
          ('auto_heal_plan', 'AUTO_HEAL_REMAINING', r.package_id::text, 'package',
           jsonb_build_object('failed_step_keys', r.failed_step_keys),
           'skipped', skip_reason);
      END IF;

      RETURN NEXT;
      CONTINUE;
    END IF;

    package_id    := r.package_id;
    package_title := r.package_title;
    track         := r.track;
    action        := 'reset_and_nudge';
    step_keys     := r.failed_step_keys;
    active_jobs   := 0;
    skip_reason   := NULL;
    applied       := false;

    IF NOT p_dry_run AND COALESCE(array_length(r.failed_step_keys, 1), 0) > 0 THEN
      BEGIN
        v_reset := public.admin_step_reset_detailed(
          p_package_id  := r.package_id,
          p_step_keys   := r.failed_step_keys,
          p_reason      := 'auto_heal_remaining_plan',
          p_source      := 'auto_heal_plan',
          p_nudge_atomic := true
        );
        applied := true;

        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_id, target_type,
           input_params, result_status, result_detail)
        VALUES
          ('auto_heal_plan', 'AUTO_HEAL_REMAINING', r.package_id::text, 'package',
           jsonb_build_object('failed_step_keys', r.failed_step_keys),
           'success', COALESCE(v_reset::text, '{}'));
      EXCEPTION WHEN OTHERS THEN
        applied := false;
        skip_reason := 'reset_failed: ' || SQLERRM;
        action := 'failed';

        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_id, target_type,
           input_params, result_status, error_message)
        VALUES
          ('auto_heal_plan', 'AUTO_HEAL_REMAINING', r.package_id::text, 'package',
           jsonb_build_object('failed_step_keys', r.failed_step_keys),
           'failed', SQLERRM);
      END;
    END IF;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_auto_heal_remaining(int, boolean) TO authenticated;
