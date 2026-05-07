-- ─────────────────────────────────────────────────────────
-- Part A: Honest push-wrapper
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_push_queued_no_lessons_to_build(p_dry_run boolean DEFAULT true, p_max integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg uuid;
  v_promoted int := 0;
  v_skipped int := 0;
  v_no_effect int := 0;
  v_results jsonb := '[]'::jsonb;
  v_skip_reasons jsonb := '{}'::jsonb;
  v_eligible uuid[];
  v_wip int;
  v_res jsonb;
  v_status text;
  v_reason text;
  v_ok boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*) INTO v_wip FROM course_packages WHERE status='building' AND archived=false;
  IF v_wip >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wip_cap_reached', 'wip_current', v_wip);
  END IF;

  SELECT array_agg(cp.id ORDER BY cp.title) INTO v_eligible
  FROM (
    SELECT cp.id, cp.title FROM course_packages cp
    JOIN v_learning_integrity_audit a ON a.package_id = cp.id
    WHERE cp.status='queued' AND a.gate_no_lessons=true AND cp.archived=false
      AND COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) = false
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled'))
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id AND jq.status='failed' AND jq.created_at > now() - interval '6 hours')
    LIMIT LEAST(p_max, GREATEST(0, 60 - v_wip))
  ) cp;

  IF v_eligible IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'promoted', 0, 'skipped', 0, 'reason', 'no_eligible');
  END IF;

  IF p_dry_run THEN
    INSERT INTO auto_heal_log(target_type, action_type, result_status, metadata)
    VALUES ('system','lxi_queued_no_lessons_pushed','dry_run',
      jsonb_build_object('candidates', to_jsonb(v_eligible), 'count', array_length(v_eligible,1)));
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'candidates', to_jsonb(v_eligible));
  END IF;

  FOREACH v_pkg IN ARRAY v_eligible LOOP
    BEGIN
      v_res    := public.admin_nudge_atomic_trigger(v_pkg, false);
      v_ok     := COALESCE((v_res->>'ok')::boolean, false);
      v_status := COALESCE(v_res->>'status', '');
      v_reason := COALESCE(v_res->>'skip_reason', v_res->>'reason', NULL);

      IF v_ok = true OR v_status IN ('success','enqueued','nudged') THEN
        v_promoted := v_promoted + 1;
        v_results  := v_results || jsonb_build_object('package_id', v_pkg, 'result', 'promoted', 'detail', v_res);
      ELSE
        v_no_effect := v_no_effect + 1;
        v_reason := COALESCE(v_reason, 'nudge_no_effect');
        v_skip_reasons := jsonb_set(v_skip_reasons,
          ARRAY[v_reason],
          to_jsonb(COALESCE((v_skip_reasons->>v_reason)::int, 0) + 1));
        v_results := v_results || jsonb_build_object('package_id', v_pkg, 'result', 'no_effect', 'reason', v_reason, 'detail', v_res);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'result', 'error', 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_type, action_type, result_status, metadata)
  VALUES ('system','lxi_queued_no_lessons_pushed',
    CASE WHEN v_promoted > 0 THEN 'success'
         WHEN v_no_effect > 0 OR v_skipped > 0 THEN 'no_effect'
         ELSE 'partial' END,
    jsonb_build_object('promoted', v_promoted, 'no_effect', v_no_effect, 'skipped', v_skipped,
                       'skip_reasons', v_skip_reasons, 'wip_before', v_wip, 'results', v_results));

  RETURN jsonb_build_object('ok', true, 'promoted', v_promoted, 'no_effect', v_no_effect,
                            'skipped', v_skipped, 'skip_reasons', v_skip_reasons,
                            'wip_before', v_wip, 'results', v_results);
END;
$function$;

-- ─────────────────────────────────────────────────────────
-- Part B: Per-package safe Re-Init for lesson-track skipped steps
-- ─────────────────────────────────────────────────────────
-- Strategy: only re-queue the bootstrap step `scaffold_learning_course`.
-- Once it runs, the pipeline cascades the rest of the chain naturally.
-- Governance steps (auto_publish, quality_council, run_integrity_check) and
-- any step with should_run=false in track_step_applicability are never touched.

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
  v_nudge jsonb;
  v_skip_reason text := NULL;
  GOVERNANCE_STEPS text[] := ARRAY['auto_publish','quality_council','run_integrity_check','elite_harden'];
  -- Lesson chain bootstrap (single canonical entry point)
  BOOTSTRAP_STEP text := 'scaffold_learning_course';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT cp.id, cp.title, cp.status::text AS status, cp.archived, cp.curriculum_id, cp.track::text AS track,
         COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) AS bronze_locked
  INTO v_pkg
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  -- Eligibility
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
    -- Track must allow the bootstrap step
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

  -- Compute candidate sets (always, for visibility)
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

  -- Real run: reset bootstrap step skipped → queued
  SELECT id, step_key INTO v_bootstrap_step
  FROM package_steps
  WHERE package_id = p_package_id AND status='skipped' AND step_key = BOOTSTRAP_STEP
  LIMIT 1;

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

  -- Trigger nudge — promotes queued→building and nudges first queued step
  v_nudge := public.admin_nudge_atomic_trigger(p_package_id, false);

  INSERT INTO auto_heal_log(target_type, action_type, target_id, result_status, metadata)
  VALUES ('package','lxi_queued_no_lessons_reinit_applied', p_package_id::text,
          CASE WHEN COALESCE((v_nudge->>'ok')::boolean, false) THEN 'success' ELSE 'no_effect' END,
          jsonb_build_object('package_id', p_package_id, 'reset_step', v_bootstrap_step,
                             'nudge_result', v_nudge));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id,
                            'reset_step', to_jsonb(v_bootstrap_step),
                            'nudge_result', v_nudge);
END;
$function$;

-- ─────────────────────────────────────────────────────────
-- Part C: Batch RPC
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lxi_reinit_queued_no_lessons_batch(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg uuid;
  v_eligible uuid[];
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_wip int;
  v_applied int := 0;
  v_no_effect int := 0;
  v_real_cap int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF NOT p_dry_run AND p_limit > 10 THEN
    RAISE EXCEPTION 'real_run_limit_exceeded: max 10, got %', p_limit;
  END IF;

  SELECT COUNT(*) INTO v_wip FROM course_packages WHERE status='building' AND archived=false;
  IF v_wip >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wip_cap_reached', 'wip_current', v_wip);
  END IF;
  v_real_cap := LEAST(p_limit, GREATEST(0, 60 - v_wip));

  SELECT array_agg(cp.id ORDER BY cp.title) INTO v_eligible
  FROM (
    SELECT cp.id, cp.title FROM course_packages cp
    JOIN v_learning_integrity_audit a ON a.package_id = cp.id
    WHERE cp.status='queued' AND a.gate_no_lessons=true AND cp.archived=false
      AND COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) = false
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id
                      AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled'))
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id
                      AND jq.status='failed' AND jq.created_at > now() - interval '6 hours')
    LIMIT v_real_cap
  ) cp;

  IF v_eligible IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason','no_eligible', 'wip_current', v_wip);
  END IF;

  FOREACH v_pkg IN ARRAY v_eligible LOOP
    v_one := public.admin_lxi_reinit_skipped_steps_for_lesson_track(v_pkg, p_dry_run);
    IF COALESCE((v_one->>'ok')::boolean, false) AND NOT p_dry_run THEN
      v_applied := v_applied + 1;
    ELSIF NOT p_dry_run THEN
      v_no_effect := v_no_effect + 1;
    END IF;
    v_results := v_results || v_one;
  END LOOP;

  INSERT INTO auto_heal_log(target_type, action_type, result_status, metadata)
  VALUES ('system',
          CASE WHEN p_dry_run THEN 'lxi_queued_no_lessons_reinit_batch_dry_run'
               ELSE 'lxi_queued_no_lessons_reinit_batch_applied' END,
          CASE WHEN p_dry_run THEN 'dry_run'
               WHEN v_applied > 0 THEN 'success'
               ELSE 'no_effect' END,
          jsonb_build_object('candidates', to_jsonb(v_eligible),
                             'applied', v_applied, 'no_effect', v_no_effect,
                             'wip_before', v_wip, 'results', v_results));

  RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run,
                            'candidates_count', array_length(v_eligible,1),
                            'applied', v_applied, 'no_effect', v_no_effect,
                            'wip_before', v_wip, 'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lxi_reinit_skipped_steps_for_lesson_track(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_lxi_reinit_queued_no_lessons_batch(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lxi_reinit_skipped_steps_for_lesson_track(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lxi_reinit_queued_no_lessons_batch(int, boolean) TO authenticated;