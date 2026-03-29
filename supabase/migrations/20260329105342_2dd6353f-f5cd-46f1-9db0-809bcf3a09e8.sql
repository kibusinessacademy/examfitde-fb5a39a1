
-- ═══════════════════════════════════════════════════════════════
-- P0: repair_exam_pool_quality step + retry cutoff + false_active fix + pipeline events
-- ═══════════════════════════════════════════════════════════════

-- 1) Register new job type in DB registry
INSERT INTO ops_job_type_registry (job_type) VALUES ('package_repair_exam_pool_quality')
ON CONFLICT DO NOTHING;

-- 2) Add repair_exam_pool_quality step to DAG
-- validate_exam_pool (FAIL) → repair_exam_pool_quality → validate_exam_pool (retry)
-- The repair step depends on generate_exam_pool (same as validate_exam_pool)
INSERT INTO pipeline_dag_edges (step_key, depends_on) VALUES ('repair_exam_pool_quality', 'generate_exam_pool')
ON CONFLICT DO NOTHING;

-- 3) Unblock currently loop-guarded packages
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE status = 'blocked'
  AND blocked_reason LIKE 'loop_guard_validate_exam_pool%';

-- 4) Create the repair RPC function
CREATE OR REPLACE FUNCTION public.repair_exam_pool_quality(
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted int := 0;
  v_flagged int := 0;
  v_missing_lf_count int := 0;
  v_result jsonb;
BEGIN
  -- A) Auto-promote draft questions that already pass elite guards
  --    These have qc_status = 'tier1_passed' but are stuck in 'draft'
  WITH promotable AS (
    SELECT eq.id
    FROM exam_questions eq
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'draft'
      AND eq.qc_status = 'tier1_passed'
      AND eq.question_text IS NOT NULL
      AND length(eq.question_text) >= 60
      AND eq.correct_answer IS NOT NULL
      AND eq.difficulty IS NOT NULL
      AND eq.cognitive_level IS NOT NULL
      AND eq.learning_field_id IS NOT NULL
      AND eq.competency_id IS NOT NULL
      AND eq.exam_part IS NOT NULL
      AND jsonb_array_length(COALESCE(eq.options, '[]'::jsonb)) >= 4
      AND eq.explanation IS NOT NULL
      AND length(eq.explanation) >= 80
  ),
  promoted AS (
    UPDATE exam_questions eq
    SET status = 'approved',
        updated_at = now()
    FROM promotable p
    WHERE eq.id = p.id
    RETURNING eq.id
  )
  SELECT count(*) INTO v_promoted FROM promoted;

  -- B) Count missing LF coverage (for reporting, actual fill requires LLM)
  SELECT count(*) INTO v_missing_lf_count
  FROM learning_fields lf
  WHERE lf.curriculum_id = p_curriculum_id
    AND NOT EXISTS (
      SELECT 1 FROM exam_questions eq
      WHERE eq.learning_field_id = lf.id
        AND eq.curriculum_id = p_curriculum_id
        AND eq.status = 'approved'
    );

  -- C) Fix missing trap_type on questions marked is_trap
  WITH fixed_traps AS (
    UPDATE exam_questions eq
    SET trap_type = 'typical_error',
        updated_at = now()
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.is_trap = true
      AND eq.trap_type IS NULL
    RETURNING eq.id
  )
  SELECT count(*) INTO v_flagged FROM fixed_traps;

  v_result := jsonb_build_object(
    'promoted_to_approved', v_promoted,
    'trap_types_fixed', v_flagged,
    'missing_lf_coverage', v_missing_lf_count,
    'curriculum_id', p_curriculum_id
  );

  RETURN v_result;
END;
$$;

-- 5) Pipeline event emission trigger on step transitions
CREATE OR REPLACE FUNCTION public.fn_emit_pipeline_event_on_step_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only emit on real status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO course_pipeline_events (package_id, event_type, created_at)
    VALUES (
      NEW.package_id,
      'step_' || NEW.step_key || '_' || NEW.status,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists, then create
DROP TRIGGER IF EXISTS trg_emit_pipeline_event_on_step_change ON package_steps;
CREATE TRIGGER trg_emit_pipeline_event_on_step_change
  AFTER UPDATE OF status ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION fn_emit_pipeline_event_on_step_change();

-- 6) Immediate false_active reset function
CREATE OR REPLACE FUNCTION public.reset_false_active_packages()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH resettable AS (
    SELECT bat.package_id
    FROM ops_build_activity_truth bat
    WHERE bat.status = 'building'
      AND bat.liveness_verdict IN ('false_active', 'no_activity')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = bat.package_id
          AND jq.status IN ('processing', 'queued')
      )
  ),
  reset AS (
    UPDATE course_packages cp
    SET status = 'queued',
        updated_at = now()
    FROM resettable r
    WHERE cp.id = r.package_id
    RETURNING cp.id
  )
  SELECT count(*) INTO v_count FROM reset;

  -- Release orphan leases
  DELETE FROM package_leases pl
  WHERE NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = pl.package_id
      AND jq.status IN ('processing', 'queued')
  )
  AND pl.package_id IN (
    SELECT package_id FROM ops_build_activity_truth
    WHERE liveness_verdict IN ('false_active', 'no_activity')
  );

  RETURN v_count;
END;
$$;

-- 7) Run immediate cleanup
SELECT reset_false_active_packages();
