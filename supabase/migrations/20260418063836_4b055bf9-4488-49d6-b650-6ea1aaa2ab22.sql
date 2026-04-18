
CREATE OR REPLACE FUNCTION public.admin_soft_reset_package(
  p_package_id uuid,
  p_take_offline boolean DEFAULT true,
  p_reason text DEFAULT 'manual_admin_pipeline_reset'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.course_packages%rowtype;
  v_now timestamptz := now();
  v_cancelled_jobs int := 0;
  v_reset_steps int := 0;
BEGIN
  SELECT * INTO v_pkg FROM public.course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PACKAGE_NOT_FOUND', 'package_id', p_package_id);
  END IF;

  WITH c AS (
    UPDATE public.job_queue
    SET status = 'cancelled',
        last_error = COALESCE(last_error,'') || ' | ' || p_reason,
        updated_at = v_now,
        completed_at = v_now
    WHERE package_id = p_package_id
      AND status IN ('pending','queued','processing','running','batch_pending')
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled_jobs FROM c;

  -- Single atomic update: Status + meta-bypass in ONE statement.
  -- Ghost-Guard prüft nur NEW.status='done', daher OK.
  -- Regression-Guard sieht NEW.meta.allow_regression=true direkt.
  WITH r AS (
    UPDATE public.package_steps
    SET status = 'queued'::step_status,
        updated_at = v_now,
        started_at = NULL,
        finished_at = NULL,
        last_heartbeat_at = NULL,
        runner_id = NULL,
        job_id = NULL,
        last_error = NULL,
        attempts = 0,
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'ops_force_reset',
          'reset_reason', p_reason,
          'reset_at', v_now,
          'ok', false,
          'executed', false
        )
    WHERE package_id = p_package_id
      AND status <> 'skipped'::step_status
    RETURNING 1
  )
  SELECT count(*) INTO v_reset_steps FROM r;

  IF p_take_offline THEN
    UPDATE public.course_packages
    SET status = 'blocked',
        is_published = false,
        blocked_reason = 'admin_hold',
        updated_at = v_now
    WHERE id = p_package_id;
  END IF;

  INSERT INTO public.admin_actions(action, scope, affected_ids, payload)
  VALUES (
    'admin_pipeline_soft_reset',
    'course_package',
    ARRAY[p_package_id::text],
    jsonb_build_object(
      'reset_mode', 'soft',
      'reason', p_reason,
      'cancelled_jobs', v_cancelled_jobs,
      'reset_steps', v_reset_steps,
      'take_offline', p_take_offline,
      'package_status_before', v_pkg.status,
      'is_published_before', v_pkg.is_published
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'cancelled_jobs', v_cancelled_jobs,
    'reset_steps', v_reset_steps,
    'package_status_after', CASE WHEN p_take_offline THEN 'blocked' ELSE v_pkg.status END,
    'is_published_after', CASE WHEN p_take_offline THEN false ELSE v_pkg.is_published END
  );
END;
$$;

SELECT public.admin_soft_reset_package('3e070545-c555-417a-a047-c7541ebb2a7c', true, 'manual_admin_pipeline_reset:immobiliardarlehensvermittler');
SELECT public.admin_soft_reset_package('5377ab93-fe17-488c-a266-bdb26b672da7', true, 'manual_admin_pipeline_reset:kaufmann_bueromanagement');
