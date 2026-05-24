-- P1.1b: Add dry-run mode to governance recovery verifier
-- Default behaviour unchanged (cron still calls without args).

CREATE OR REPLACE FUNCTION public.fn_verify_governance_completion_recovery(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_verified int := 0;
  v_stuck int := 0;
  v_skipped int := 0;
  v_would_verify int := 0;
  v_would_stuck int := 0;
  v_already_audited boolean;
BEGIN
  FOR r IN
    SELECT *
    FROM public.v_governance_completion_recovery_outcomes
    WHERE is_latest_dispatch = true
      AND dispatched_at > now() - interval '24 hours'
      AND minutes_since_dispatch >= 5
  LOOP
    IF r.recovered THEN
      SELECT EXISTS (
        SELECT 1 FROM public.auto_heal_log
        WHERE action_type = 'governance_completion_recovery_verified'
          AND target_id = r.package_id::text
          AND (metadata->>'job_id')::uuid = r.job_id
      ) INTO v_already_audited;

      IF v_already_audited THEN
        v_skipped := v_skipped + 1;
      ELSIF p_dry_run THEN
        v_would_verify := v_would_verify + 1;
      ELSE
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
        VALUES (
          'governance_completion_recovery_verified',
          r.package_id::text, 'course_package', 'success',
          jsonb_build_object(
            'package_key', r.package_key,
            'job_id', r.job_id,
            'recovered', true,
            'stuck', false,
            'minutes_since_dispatch', round(r.minutes_since_dispatch::numeric, 2),
            'quality_score', r.quality_score,
            'council_approved', r.council_approved
          )
        );
        v_verified := v_verified + 1;
      END IF;

    ELSIF r.stuck THEN
      SELECT EXISTS (
        SELECT 1 FROM public.auto_heal_log
        WHERE action_type = 'governance_completion_recovery_stuck'
          AND target_id = r.package_id::text
          AND (metadata->>'job_id')::uuid = r.job_id
      ) INTO v_already_audited;

      IF v_already_audited THEN
        v_skipped := v_skipped + 1;
      ELSIF p_dry_run THEN
        v_would_stuck := v_would_stuck + 1;
      ELSE
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
        VALUES (
          'governance_completion_recovery_stuck',
          r.package_id::text, 'course_package', 'failed',
          jsonb_build_object(
            'package_key', r.package_key,
            'job_id', r.job_id,
            'failure_reason', COALESCE(r.failure_reason, 'unknown'),
            'minutes_since_dispatch', round(r.minutes_since_dispatch::numeric, 2),
            'job_status', r.job_status,
            'recovered', false,
            'stuck', true
          )
        );
        v_stuck := v_stuck + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'verified', v_verified,
    'stuck', v_stuck,
    'would_verify', v_would_verify,
    'would_stuck', v_would_stuck,
    'skipped_duplicate', v_skipped,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_verify_governance_completion_recovery(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_verify_governance_completion_recovery(boolean) TO service_role;