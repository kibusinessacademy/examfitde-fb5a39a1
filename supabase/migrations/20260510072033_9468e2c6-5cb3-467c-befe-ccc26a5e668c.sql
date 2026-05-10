-- admin_revive_cancelled_job: bypass BEFORE-UPDATE terminal regression guard with audit
-- Use case: jobs cancelled by ops_cancel_pending_non_building_jobs before policy was set
-- Rollback: DROP FUNCTION public.admin_revive_cancelled_job(uuid, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.admin_revive_cancelled_job(
  p_job_id     uuid,
  p_reason     text,
  p_new_status text        DEFAULT 'pending',
  p_run_after  timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_job   record;
  v_run_after timestamptz := COALESCE(p_run_after, now());
BEGIN
  -- Gate: admin only
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'reason required (min 8 chars)';
  END IF;

  IF p_new_status NOT IN ('pending','queued') THEN
    RAISE EXCEPTION 'invalid target status %, expected pending|queued', p_new_status;
  END IF;

  SELECT * INTO v_job FROM public.job_queue WHERE id = p_job_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'job not found: %', p_job_id;
  END IF;

  IF v_job.status NOT IN ('cancelled','failed') THEN
    RAISE EXCEPTION 'job % not in revivable status (current=%)', p_job_id, v_job.status;
  END IF;

  -- Bypass BEFORE-UPDATE triggers (e.g. fn_guard_terminal_status_regression)
  PERFORM set_config('session_replication_role', 'replica', true);

  UPDATE public.job_queue
  SET status     = p_new_status,
      run_after  = v_run_after,
      locked_at  = NULL,
      locked_by  = NULL,
      last_error = NULL,
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'revived_at', now(),
        'revived_by', v_actor,
        'revive_reason', p_reason,
        'previous_status_before_revive', v_job.status,
        'revive_source', 'admin_revive_cancelled_job',
        'revive_bypassed_triggers', true
      )
  WHERE id = p_job_id;

  PERFORM set_config('session_replication_role', 'origin', true);

  INSERT INTO public.auto_heal_log (
    action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
  ) VALUES (
    'admin_revive_cancelled_job',
    'admin_revive_cancelled_job',
    'job',
    p_job_id,
    'revived',
    format('Revived %s (%s → %s) — %s', v_job.job_type, v_job.status, p_new_status, p_reason),
    jsonb_build_object(
      'job_id', p_job_id,
      'job_type', v_job.job_type,
      'package_id', v_job.package_id,
      'previous_status', v_job.status,
      'new_status', p_new_status,
      'run_after', v_run_after,
      'actor_uid', v_actor,
      'reason', p_reason,
      'bypass_used', 'session_replication_role=replica'
    )
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'previous_status', v_job.status,
    'new_status', p_new_status,
    'run_after', v_run_after,
    'reason', p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_revive_cancelled_job(uuid,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revive_cancelled_job(uuid,text,text,timestamptz) TO authenticated;