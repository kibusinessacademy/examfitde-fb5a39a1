-- Phase 2 Härtung — Fix #1: Pre-Enqueue SSOT Applicability Guard + Drift-Bereinigung
-- Bereinigt 14 verwaiste package_steps in EXAM_FIRST/EXAM_FIRST_PLUS, deren Step laut SSOT skipped sein muss
-- Erweitert den Trigger fn_guard_ssot_applicability so, dass er auch 'queued' Status erfasst (nicht nur 'pending')

-- ── Teil A: Drift-Bereinigung ──
-- Setze alle package_steps auf 'skipped', deren track laut track_step_applicability.should_run=false ist
-- und die nicht bereits skipped/done sind
WITH drift AS (
  SELECT ps.package_id, ps.step_key, cp.track::text AS track
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  JOIN track_step_applicability tsa
    ON tsa.track = cp.track AND tsa.step_key = ps.step_key
  WHERE tsa.should_run = false
    AND tsa.condition IS NULL
    AND ps.status NOT IN ('skipped','done')
)
UPDATE package_steps ps
SET
  status = 'skipped',
  updated_at = now(),
  meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
    'skip_reason', 'ssot_applicability_drift_cleanup',
    'skipped_by', 'migration_2026_04_18_phase2_fix1',
    'skipped_at', now(),
    'track', drift.track
  )
FROM drift
WHERE ps.package_id = drift.package_id AND ps.step_key = drift.step_key;

-- Logge die Bereinigung
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
SELECT
  'ssot_applicability_drift_cleanup',
  'migration_2026_04_18_phase2_fix1',
  'package_step',
  ps.package_id,
  'applied',
  format('Drift cleanup: step=%s track=%s set to skipped', ps.step_key, cp.track),
  jsonb_build_object('step_key', ps.step_key, 'track', cp.track)
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.meta->>'skipped_by' = 'migration_2026_04_18_phase2_fix1';

-- ── Teil B: Trigger-Erweiterung ──
-- Erfasse auch 'queued' Status (heute nur 'pending' geprüft)
-- Damit werden Jobs, die direkt auf queued gesetzt werden, ebenfalls abgefangen
CREATE OR REPLACE FUNCTION public.fn_guard_ssot_applicability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_key text;
  v_track text;
  v_should_run boolean;
  v_condition text;
BEGIN
  -- Erweitert: erfasse pending UND queued (vorher nur pending)
  IF NEW.status NOT IN ('pending','queued') OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT step_key INTO v_step_key
  FROM (VALUES
    ('package_scaffold_learning_course','scaffold_learning_course'),
    ('package_generate_glossary','generate_glossary'),
    ('package_fanout_learning_content','fanout_learning_content'),
    ('package_generate_learning_content','generate_learning_content'),
    ('package_finalize_learning_content','finalize_learning_content'),
    ('package_validate_learning_content','validate_learning_content'),
    ('package_auto_seed_exam_blueprints','auto_seed_exam_blueprints'),
    ('package_validate_blueprints','validate_blueprints'),
    ('package_generate_blueprint_variants','generate_blueprint_variants'),
    ('package_validate_blueprint_variants','validate_blueprint_variants'),
    ('package_promote_blueprint_variants','promote_blueprint_variants'),
    ('package_generate_exam_pool','generate_exam_pool'),
    ('package_validate_exam_pool','validate_exam_pool'),
    ('package_repair_exam_pool_quality','repair_exam_pool_quality'),
    ('package_build_ai_tutor_index','build_ai_tutor_index'),
    ('package_validate_tutor_index','validate_tutor_index'),
    ('package_generate_oral_exam','generate_oral_exam'),
    ('package_validate_oral_exam','validate_oral_exam'),
    ('package_generate_lesson_minichecks','generate_lesson_minichecks'),
    ('package_validate_lesson_minichecks','validate_lesson_minichecks'),
    ('package_generate_handbook','generate_handbook'),
    ('package_validate_handbook','validate_handbook'),
    ('package_enqueue_handbook_expand','enqueue_handbook_expand'),
    ('handbook_expand_section','expand_handbook'),
    ('package_validate_handbook_depth','validate_handbook_depth'),
    ('package_elite_harden','elite_harden'),
    ('package_run_integrity_check','run_integrity_check'),
    ('package_quality_council','quality_council'),
    ('package_auto_publish','auto_publish')
  ) AS m(job_type, step_key)
  WHERE m.job_type = NEW.job_type;

  IF v_step_key IS NULL THEN RETURN NEW; END IF;

  SELECT track::text INTO v_track FROM course_packages WHERE id = NEW.package_id;
  IF v_track IS NULL THEN RETURN NEW; END IF;

  SELECT tsa.should_run, tsa.condition INTO v_should_run, v_condition
  FROM track_step_applicability tsa
  WHERE tsa.track = v_track::product_track AND tsa.step_key = v_step_key;

  IF v_should_run IS NOT NULL AND v_should_run = false AND v_condition IS NULL THEN
    NEW.status := 'cancelled';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'ssot_applicability_guard',
      'transition_source', 'trg_guard_ssot_applicability',
      'blocked_step', v_step_key,
      'package_track', v_track,
      'original_status', NEW.status
    );
    NEW.completed_at := now();

    -- Auto-skip the step too (idempotent)
    UPDATE package_steps
    SET status = 'skipped',
        updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'skip_reason', 'ssot_applicability_guard',
          'skipped_by', 'trg_guard_ssot_applicability',
          'skipped_at', now()
        )
    WHERE package_id = NEW.package_id
      AND step_key = v_step_key
      AND status NOT IN ('skipped','done');

    BEGIN
      PERFORM fn_log_guardrail_event(
        'ssot_applicability_guard',
        jsonb_build_object('job_type', NEW.job_type, 'step_key', v_step_key, 'track', v_track, 'package_id', NEW.package_id)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;