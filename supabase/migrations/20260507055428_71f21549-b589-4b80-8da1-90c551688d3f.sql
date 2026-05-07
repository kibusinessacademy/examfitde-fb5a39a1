-- ─────────────────────────────────────────────────────────
-- Part A: Audit-Snapshot table for heal attempts
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lxi_heal_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  step_id uuid,
  step_key text,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  nudge_result jsonb,
  executed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  rollback_reason text,
  rollback_result jsonb
);

CREATE INDEX IF NOT EXISTS idx_lxi_heal_attempts_pkg ON public.lxi_heal_attempts(package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lxi_heal_attempts_action ON public.lxi_heal_attempts(action_type, created_at DESC);

ALTER TABLE public.lxi_heal_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_select_lxi_heal_attempts" ON public.lxi_heal_attempts;
CREATE POLICY "admins_select_lxi_heal_attempts" ON public.lxi_heal_attempts
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies — only service_role / SECURITY DEFINER RPCs may write.

-- ─────────────────────────────────────────────────────────
-- Part B: Reinit RPC v2 — captures snapshot + returns attempt_id
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lxi_reinit_skipped_steps_for_lesson_track(
  p_package_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_audit RECORD;
  v_active_jobs int;
  v_recent_failed int;
  v_queued_steps int;
  v_skipped_total int;
  v_non_applicable int;
  v_reset_candidates jsonb;
  v_bootstrap_step RECORD;
  v_before jsonb;
  v_after jsonb;
  v_attempt_id uuid;
  v_nudge jsonb;
  v_skip_reason text := NULL;
  GOVERNANCE_STEPS text[] := ARRAY['auto_publish','quality_council','run_integrity_check','elite_harden'];
  BOOTSTRAP_STEP text := 'scaffold_learning_course';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT cp.id, cp.title, cp.status::text AS status, cp.archived, cp.curriculum_id, cp.track::text AS track,
         COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) AS bronze_locked
  INTO v_pkg
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'package_not_found'); END IF;

  IF v_pkg.archived THEN v_skip_reason := 'archived';
  ELSIF v_pkg.status <> 'queued' THEN v_skip_reason := 'not_queued_status';
  ELSIF v_pkg.bronze_locked THEN v_skip_reason := 'bronze_locked';
  ELSIF v_pkg.curriculum_id IS NULL THEN v_skip_reason := 'no_curriculum';
  END IF;

  IF v_skip_reason IS NULL THEN
    SELECT COUNT(*) INTO v_active_jobs FROM job_queue
     WHERE package_id = p_package_id
       AND status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');
    IF v_active_jobs > 0 THEN v_skip_reason := 'has_active_jobs'; END IF;
  END IF;

  IF v_skip_reason IS NULL THEN
    SELECT COUNT(*) INTO v_recent_failed FROM job_queue
     WHERE package_id = p_package_id AND status='failed' AND created_at > now() - interval '6 hours';
    IF v_recent_failed > 0 THEN v_skip_reason := 'recent_failed_jobs'; END IF;
  END IF;

  IF v_skip_reason IS NULL THEN
    SELECT gate_no_lessons INTO v_audit FROM v_learning_integrity_audit WHERE package_id = p_package_id;
    IF v_audit IS NULL OR v_audit.gate_no_lessons IS NOT TRUE THEN
      v_skip_reason := 'gate_no_lessons_false';
    END IF;
  END IF;

  IF v_skip_reason IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM track_step_applicability tsa
                   WHERE tsa.track::text = v_pkg.track AND tsa.step_key = BOOTSTRAP_STEP AND tsa.should_run = true) THEN
      v_skip_reason := 'bootstrap_step_not_applicable_for_track';
    END IF;
  END IF;

  IF v_skip_reason IS NULL THEN
    SELECT COUNT(*) FILTER (WHERE status='queued'),
           COUNT(*) FILTER (WHERE status='skipped')
      INTO v_queued_steps, v_skipped_total
    FROM package_steps WHERE package_id = p_package_id;

    IF v_queued_steps > 0 THEN v_skip_reason := 'has_queued_steps_already'; END IF;
    IF v_skipped_total = 0 THEN v_skip_reason := COALESCE(v_skip_reason, 'no_skipped_steps'); END IF;
  END IF;

  SELECT COUNT(*) INTO v_non_applicable
  FROM package_steps ps
  LEFT JOIN track_step_applicability tsa
    ON tsa.track::text = v_pkg.track AND tsa.step_key = ps.step_key
  WHERE ps.package_id = p_package_id AND ps.status='skipped'
    AND COALESCE(tsa.should_run, true) = false;

  SELECT jsonb_agg(jsonb_build_object('step_id', id, 'step_key', step_key) ORDER BY step_key)
  INTO v_reset_candidates
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status='skipped'
    AND ps.step_key = BOOTSTRAP_STEP
    AND NOT (ps.step_key = ANY(GOVERNANCE_STEPS));

  IF v_skip_reason IS NULL AND (v_reset_candidates IS NULL OR jsonb_array_length(v_reset_candidates)=0) THEN
    v_skip_reason := 'no_bootstrap_step_to_reset';
  END IF;

  IF p_dry_run OR v_skip_reason IS NOT NULL THEN
    INSERT INTO auto_heal_log(target_type, action_type, target_id, result_status, metadata)
    VALUES ('package',
            CASE WHEN v_skip_reason IS NOT NULL THEN 'lxi_queued_no_lessons_reinit_no_effect'
                 ELSE 'lxi_queued_no_lessons_reinit_dry_run' END,
            p_package_id::text,
            CASE WHEN v_skip_reason IS NOT NULL THEN 'no_effect' ELSE 'dry_run' END,
            jsonb_build_object(
              'package_id', p_package_id, 'title', v_pkg.title, 'track', v_pkg.track,
              'skipped_steps_total', v_skipped_total,
              'non_applicable_steps', v_non_applicable,
              'reset_candidates', v_reset_candidates,
              'skip_reason', v_skip_reason,
              'expected_first_step', BOOTSTRAP_STEP));
    RETURN jsonb_build_object(
      'ok', v_skip_reason IS NULL, 'dry_run', p_dry_run,
      'package_id', p_package_id, 'track', v_pkg.track,
      'skipped_steps_total', v_skipped_total,
      'non_applicable_steps', v_non_applicable,
      'reset_candidates', COALESCE(v_reset_candidates, '[]'::jsonb),
      'expected_first_step', BOOTSTRAP_STEP,
      'skip_reason', v_skip_reason);
  END IF;

  -- Real run: capture before-state, reset, capture after-state, snapshot to lxi_heal_attempts
  SELECT id, step_key INTO v_bootstrap_step
  FROM package_steps
  WHERE package_id = p_package_id AND status='skipped' AND step_key = BOOTSTRAP_STEP
  LIMIT 1;

  SELECT jsonb_build_object(
    'package_status', v_pkg.status,
    'step', to_jsonb(ps.*)
  ) INTO v_before
  FROM package_steps ps WHERE ps.id = v_bootstrap_step.id;

  UPDATE package_steps
  SET status = 'queued'::step_status,
      attempts = 0,
      last_error = NULL,
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'reinit_reason','lxi_queued_no_lessons_reinit',
        'reinit_at', now(),
        'previous_status','skipped')
  WHERE id = v_bootstrap_step.id;

  SELECT jsonb_build_object('step', to_jsonb(ps.*))
    INTO v_after
  FROM package_steps ps WHERE ps.id = v_bootstrap_step.id;

  v_nudge := public.admin_nudge_atomic_trigger(p_package_id, false);

  INSERT INTO lxi_heal_attempts(package_id, action_type, status, step_id, step_key,
                                before_state, after_state, nudge_result, executed_by)
  VALUES (p_package_id, 'lxi_queued_no_lessons_reinit',
          CASE WHEN COALESCE((v_nudge->>'ok')::boolean, false) THEN 'applied' ELSE 'applied_no_nudge' END,
          v_bootstrap_step.id, v_bootstrap_step.step_key,
          v_before, v_after, v_nudge, auth.uid())
  RETURNING id INTO v_attempt_id;

  INSERT INTO auto_heal_log(target_type, action_type, target_id, result_status, metadata)
  VALUES ('package','lxi_queued_no_lessons_reinit_applied', p_package_id::text,
          CASE WHEN COALESCE((v_nudge->>'ok')::boolean, false) THEN 'success' ELSE 'no_effect' END,
          jsonb_build_object('package_id', p_package_id, 'reset_step', v_bootstrap_step,
                             'nudge_result', v_nudge, 'attempt_id', v_attempt_id));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id,
                            'reset_step', to_jsonb(v_bootstrap_step),
                            'nudge_result', v_nudge,
                            'attempt_id', v_attempt_id);
END;
$function$;

-- ─────────────────────────────────────────────────────────
-- Part C: Rollback RPC
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lxi_rollback_heal_attempt(
  p_attempt_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a RECORD;
  v_step RECORD;
  v_before_step jsonb;
  v_prev_status text;
  v_cancelled int := 0;
  v_age interval;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_a FROM lxi_heal_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','attempt_not_found'); END IF;
  IF v_a.rolled_back_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','already_rolled_back', 'rolled_back_at', v_a.rolled_back_at);
  END IF;

  v_age := now() - v_a.created_at;
  IF v_age > interval '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'error','rollback_window_expired',
                              'age_seconds', EXTRACT(EPOCH FROM v_age));
  END IF;

  v_before_step := v_a.before_state->'step';
  v_prev_status := COALESCE(v_before_step->>'status', 'skipped');

  SELECT * INTO v_step FROM package_steps WHERE id = v_a.step_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error','step_disappeared');
  END IF;

  -- Drift guard: only roll back if current state still matches what we set
  IF v_step.status::text NOT IN ('queued','processing','running') THEN
    RETURN jsonb_build_object('ok', false, 'error','step_state_drifted',
                              'current_status', v_step.status::text);
  END IF;

  -- Cancel any jobs created by the nudge for this package since the attempt
  UPDATE job_queue
     SET status = 'cancelled',
         updated_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'cancelled_by','lxi_heal_rollback',
           'attempt_id', p_attempt_id,
           'cancelled_at', now())
   WHERE package_id = v_a.package_id
     AND created_at >= v_a.created_at
     AND status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- Restore step status
  UPDATE package_steps
     SET status = v_prev_status::step_status,
         attempts = COALESCE((v_before_step->>'attempts')::int, attempts),
         last_error = v_before_step->>'last_error',
         updated_at = now(),
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'rollback_of_attempt', p_attempt_id,
           'rollback_at', now(),
           'rollback_reason', p_reason)
   WHERE id = v_a.step_id;

  UPDATE lxi_heal_attempts
     SET rolled_back_at = now(),
         rolled_back_by = auth.uid(),
         rollback_reason = p_reason,
         rollback_result = jsonb_build_object('cancelled_jobs', v_cancelled,
                                              'restored_status', v_prev_status)
   WHERE id = p_attempt_id;

  INSERT INTO auto_heal_log(target_type, action_type, target_id, result_status, metadata)
  VALUES ('package','lxi_heal_attempt_rolled_back', v_a.package_id::text, 'success',
          jsonb_build_object('attempt_id', p_attempt_id, 'cancelled_jobs', v_cancelled,
                             'restored_status', v_prev_status, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'attempt_id', p_attempt_id,
                            'cancelled_jobs', v_cancelled,
                            'restored_status', v_prev_status);
END;
$function$;

-- ─────────────────────────────────────────────────────────
-- Part D: Read RPCs
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lxi_list_heal_attempts(
  p_limit int DEFAULT 50,
  p_package_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, package_id uuid, package_title text, action_type text, status text,
  step_key text, created_at timestamptz, rolled_back_at timestamptz,
  rollback_reason text, executed_by uuid, can_rollback boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT a.id, a.package_id, cp.title, a.action_type, a.status, a.step_key,
         a.created_at, a.rolled_back_at, a.rollback_reason, a.executed_by,
         (a.rolled_back_at IS NULL AND (now() - a.created_at) <= interval '1 hour') AS can_rollback
  FROM lxi_heal_attempts a
  LEFT JOIN course_packages cp ON cp.id = a.package_id
  WHERE (p_package_id IS NULL OR a.package_id = p_package_id)
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_lxi_get_heal_attempt_diff(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_a RECORD; v_current jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_a FROM lxi_heal_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','not_found'); END IF;

  SELECT to_jsonb(ps.*) INTO v_current FROM package_steps ps WHERE ps.id = v_a.step_id;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt', to_jsonb(v_a),
    'before', v_a.before_state,
    'after', v_a.after_state,
    'current', v_current,
    'can_rollback', (v_a.rolled_back_at IS NULL AND (now() - v_a.created_at) <= interval '1 hour')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lxi_rollback_heal_attempt(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_lxi_list_heal_attempts(int, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_lxi_get_heal_attempt_diff(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lxi_rollback_heal_attempt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lxi_list_heal_attempts(int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lxi_get_heal_attempt_diff(uuid) TO authenticated;