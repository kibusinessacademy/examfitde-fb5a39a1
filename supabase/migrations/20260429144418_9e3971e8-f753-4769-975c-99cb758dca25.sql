-- =====================================================================
-- TAIL-STEP RETRYABLE-WITH-ARTIFACTS GUARD
-- =====================================================================
-- Problem: Pakete mit vollständigen Artefakten (approved questions > 0)
-- werden vom No-Progress-Guard hart auf 'blocked' gesetzt und ihre
-- Tail-Step-Jobs (repair/integrity/council/auto_publish) gecancelt.
-- Folge: building → blocked Loop, der manuelle Heilung erzwingt.
--
-- Fix (Option B - Defense in Depth):
--   1) fn_record_integrity_run_and_check_progress: skipt Block + Cancel,
--      wenn approved questions > 0 UND ein Tail-Step offen ist.
--      Stattdessen: Audit + meta.defer_reason='TAIL_STEP_RETRYABLE_WITH_ARTIFACTS'
--      auf integrity_check_history.
--   2) fn_auto_cancel_jobs_on_package_exit: Tail-Step-Jobtypes werden bei
--      vorhandenen Artefakten NICHT gecancelt, sondern auf
--      retry_scheduled (+30min) gesetzt.
-- =====================================================================

-- Helper: ist Tail-Step-Job?
CREATE OR REPLACE FUNCTION public.is_tail_step_job_type(p_job_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_job_type IN (
    'package_repair_exam_pool_quality',
    'package_repair_exam_pool',
    'package_validate_exam_pool',
    'package_run_integrity_check',
    'package_quality_council',
    'package_auto_publish'
  );
$$;

-- Helper: hat Paket vollständige Artefakte (approved questions > 0)?
CREATE OR REPLACE FUNCTION public.package_has_approved_artifacts(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_questions eq
    WHERE eq.package_id = p_package_id
      AND eq.status = 'approved'
    LIMIT 1
  );
$$;

-- =====================================================================
-- 1) No-Progress-Guard: artefakt-aware defer
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_record_integrity_run_and_check_progress(
  p_package_id uuid, p_curriculum_id uuid, p_score integer, p_passed boolean,
  p_hard_fails text[], p_trigger_source text DEFAULT NULL::text,
  p_job_id uuid DEFAULT NULL::uuid, p_min_improvement integer DEFAULT 3,
  p_window integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_history_id uuid;
  v_recent_scores integer[];
  v_max_recent integer;
  v_min_recent integer;
  v_no_progress boolean := false;
  v_pkg_status text;
  v_pkg_published_at timestamptz;
  v_has_artifacts boolean;
  v_open_tail_step text;
BEGIN
  INSERT INTO public.integrity_check_history
    (package_id, curriculum_id, score, passed, hard_fail_count, hard_fail_reasons, trigger_source, job_id)
  VALUES
    (p_package_id, p_curriculum_id, p_score, p_passed, COALESCE(array_length(p_hard_fails,1),0),
     COALESCE(p_hard_fails, ARRAY[]::text[]), p_trigger_source, p_job_id)
  RETURNING id INTO v_history_id;

  IF p_passed THEN
    RETURN jsonb_build_object('history_id', v_history_id, 'no_progress_block', false, 'reason', 'passed');
  END IF;

  SELECT status, published_at INTO v_pkg_status, v_pkg_published_at
    FROM public.course_packages WHERE id = p_package_id;
  IF v_pkg_status = 'published' OR v_pkg_published_at IS NOT NULL THEN
    RETURN jsonb_build_object('history_id', v_history_id, 'no_progress_block', false, 'reason', 'published_skip');
  END IF;

  SELECT array_agg(score ORDER BY created_at DESC)
    INTO v_recent_scores
  FROM (
    SELECT score, created_at
      FROM public.integrity_check_history
     WHERE package_id = p_package_id AND passed = false AND score IS NOT NULL
     ORDER BY created_at DESC
     LIMIT p_window
  ) t;

  IF v_recent_scores IS NULL OR array_length(v_recent_scores, 1) < p_window THEN
    RETURN jsonb_build_object('history_id', v_history_id, 'no_progress_block', false,
                              'reason', 'insufficient_history',
                              'runs_in_window', COALESCE(array_length(v_recent_scores, 1), 0));
  END IF;

  v_max_recent := (SELECT max(s) FROM unnest(v_recent_scores) s);
  v_min_recent := (SELECT min(s) FROM unnest(v_recent_scores) s);

  IF (v_max_recent - v_min_recent) < p_min_improvement THEN
    -- ARTIFACT-AWARE DEFER: Wenn approved questions vorhanden UND ein Tail-Step offen,
    -- NICHT blocken / NICHT cancelen. Stattdessen deferred + Audit.
    v_has_artifacts := public.package_has_approved_artifacts(p_package_id);

    SELECT ps.step_key
      INTO v_open_tail_step
      FROM public.package_steps ps
     WHERE ps.package_id = p_package_id
       AND ps.step_key IN ('repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish')
       AND ps.status NOT IN ('done'::step_status, 'skipped'::step_status)
     ORDER BY CASE ps.step_key
                WHEN 'repair_exam_pool_quality' THEN 1
                WHEN 'run_integrity_check' THEN 2
                WHEN 'quality_council' THEN 3
                WHEN 'auto_publish' THEN 4
              END
     LIMIT 1;

    IF v_has_artifacts AND v_open_tail_step IS NOT NULL THEN
      UPDATE public.integrity_check_history
         SET no_progress_blocked = false
       WHERE id = v_history_id;

      INSERT INTO public.auto_heal_log
        (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'tail_step_retryable_deferred',
        'fn_record_integrity_run_and_check_progress',
        'course_package',
        p_package_id::text,
        'deferred',
        format('No-Progress-Guard skipped: artifacts present, tail step %s open. defer_reason=TAIL_STEP_RETRYABLE_WITH_ARTIFACTS',
               v_open_tail_step),
        jsonb_build_object(
          'package_id', p_package_id,
          'open_tail_step', v_open_tail_step,
          'recent_scores', v_recent_scores,
          'score_range', v_max_recent - v_min_recent,
          'window', p_window,
          'min_improvement', p_min_improvement,
          'defer_reason', 'TAIL_STEP_RETRYABLE_WITH_ARTIFACTS'
        )
      );

      RETURN jsonb_build_object(
        'history_id', v_history_id,
        'no_progress_block', false,
        'reason', 'tail_step_retryable_with_artifacts',
        'open_tail_step', v_open_tail_step,
        'recent_scores', v_recent_scores
      );
    END IF;

    -- Original Block-Pfad (nur ohne Artefakte ODER ohne offenen Tail-Step)
    v_no_progress := true;

    UPDATE public.integrity_check_history SET no_progress_blocked = true WHERE id = v_history_id;

    UPDATE public.course_packages
       SET status = 'blocked', blocked_reason = 'quality_no_progress_3x', updated_at = now()
     WHERE id = p_package_id AND status <> 'published' AND published_at IS NULL;

    UPDATE public.job_queue
       SET status = 'cancelled',
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'cancel_reason', 'quality_no_progress_3x',
             'cancel_source', 'fn_record_integrity_run_and_check_progress',
             'cancelled_at', now()
           ),
           updated_at = now()
     WHERE package_id = p_package_id
       AND status IN ('pending','processing')
       AND job_type IN ('package_run_integrity_check','package_repair_exam_pool_quality',
                        'package_repair_exam_pool','package_validate_exam_pool');

    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      '🛑 No-Progress-Guard: Quality stagnation',
      format('Package %s: %s consecutive integrity runs without score improvement (range=%s, scores=%s). Status set to blocked, repair jobs cancelled.',
        substr(p_package_id::text, 1, 8), p_window, (v_max_recent - v_min_recent), v_recent_scores::text),
      'quality', 'error', 'course_package', p_package_id,
      jsonb_build_object('recent_scores', v_recent_scores, 'window', p_window,
                         'min_improvement', p_min_improvement, 'hard_fails_latest', p_hard_fails));

    RETURN jsonb_build_object(
      'history_id', v_history_id,
      'no_progress_block', true,
      'reason', 'quality_no_progress',
      'recent_scores', v_recent_scores,
      'score_range', v_max_recent - v_min_recent
    );
  END IF;

  RETURN jsonb_build_object(
    'history_id', v_history_id,
    'no_progress_block', false,
    'reason', 'sufficient_progress',
    'recent_scores', v_recent_scores,
    'score_range', v_max_recent - v_min_recent
  );
END;
$function$;

-- =====================================================================
-- 2) Auto-Cancel-on-Exit: Tail-Step-Jobs bei Artefakten verschonen
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_cancel_jobs_on_package_exit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_cancelled int := 0;
  v_deferred int := 0;
  v_gate_class text;
  v_has_artifacts boolean;
BEGIN
  IF OLD.status = 'building' AND NEW.status IS DISTINCT FROM 'building' THEN

    IF NEW.status = 'queued' THEN RETURN NEW; END IF;

    v_gate_class := COALESCE(NEW.gate_class, 'unknown');

    IF NEW.status = 'quality_gate_failed' AND v_gate_class = 'recoverable' THEN
      NEW.status := 'building';
      NEW.gate_class := 'recoverable';
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('qgf_bounce_prevented', NEW.id, 'run_integrity_check',
              jsonb_build_object('blocked_transition', 'building→quality_gate_failed',
                                 'gate_class', v_gate_class,
                                 'reason', 'recoverable failures do not allow package termination'));
      RETURN NEW;
    END IF;

    -- ARTIFACT-AWARE DEFER für Tail-Step-Jobs
    v_has_artifacts := public.package_has_approved_artifacts(NEW.id);

    IF v_has_artifacts THEN
      -- Tail-Step-Jobs auf retry_scheduled (+30 min) statt cancelled
      WITH deferred AS (
        UPDATE job_queue jq
        SET status = 'retry_scheduled',
            scheduled_for = now() + interval '30 minutes',
            last_error = format('TAIL_STEP_DEFERRED: package %s→%s, artifacts present, retryable in 30min', OLD.status, NEW.status),
            updated_at = now(),
            locked_at = NULL,
            locked_by = NULL,
            meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
              'defer_reason', 'TAIL_STEP_RETRYABLE_WITH_ARTIFACTS',
              'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
              'transition_prev_status', jq.status,
              'transition_at', now()::text,
              'old_pkg_status', OLD.status,
              'new_pkg_status', NEW.status
            )
        WHERE jq.package_id = NEW.id
          AND jq.status IN ('pending', 'batch_pending')
          AND public.is_tail_step_job_type(jq.job_type)
        RETURNING jq.id
      )
      SELECT count(*) INTO v_deferred FROM deferred;

      IF v_deferred > 0 THEN
        INSERT INTO public.auto_heal_log
          (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES (
          'tail_step_retryable_deferred',
          'fn_auto_cancel_jobs_on_package_exit',
          'course_package',
          NEW.id::text,
          'deferred',
          format('Deferred %s tail-step jobs (artifacts present) on transition %s→%s',
                 v_deferred, OLD.status, NEW.status),
          jsonb_build_object(
            'package_id', NEW.id,
            'deferred_count', v_deferred,
            'old_status', OLD.status,
            'new_status', NEW.status,
            'gate_class', v_gate_class,
            'defer_reason', 'TAIL_STEP_RETRYABLE_WITH_ARTIFACTS'
          )
        );
      END IF;
    END IF;

    -- Original-Cancel für NICHT-Tail-Steps (oder ohne Artefakte)
    WITH cancelled AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'package_exit_building',
            'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
            'transition_prev_status', jq.status,
            'transition_at', now()::text,
            'old_pkg_status', OLD.status,
            'new_pkg_status', NEW.status
          )
      FROM job_type_policies jtp
      WHERE jtp.job_type = jq.job_type
        AND jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
        AND NOT (v_has_artifacts AND public.is_tail_step_job_type(jq.job_type))
      RETURNING jq.id
    )
    SELECT count(*) INTO v_cancelled FROM cancelled;

    WITH cancelled_unknown AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'package_exit_building',
            'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
            'transition_prev_status', jq.status,
            'transition_at', now()::text,
            'old_pkg_status', OLD.status,
            'new_pkg_status', NEW.status
          )
      WHERE jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT EXISTS (SELECT 1 FROM job_type_policies p WHERE p.job_type = jq.job_type AND p.exempt_from_auto_cancel)
        AND NOT (v_has_artifacts AND public.is_tail_step_job_type(jq.job_type))
      RETURNING jq.id
    )
    SELECT v_cancelled + count(*) INTO v_cancelled FROM cancelled_unknown;

    IF v_cancelled > 0 THEN
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('auto_cancel_on_exit', NEW.id, NULL,
              jsonb_build_object('cancelled_count', v_cancelled,
                                 'deferred_tail_count', v_deferred,
                                 'old_status', OLD.status,
                                 'new_status', NEW.status,
                                 'gate_class', v_gate_class,
                                 'has_artifacts', v_has_artifacts));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;