
-- ═══════════════════════════════════════════════════════════════
-- Phase 1: Publish-Recovery Status-Trennung
-- ═══════════════════════════════════════════════════════════════

-- 1) Extend guard_package_leases_building_only to allow publish_failed
CREATE OR REPLACE FUNCTION public.guard_package_leases_building_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM course_packages WHERE id = NEW.package_id;

  IF v_status = 'building' THEN
    RETURN NEW;
  END IF;

  -- Allow blocked/quality_gate_failed/publish_failed packages for auto-heal and repair leases
  IF v_status IN ('blocked', 'quality_gate_failed', 'publish_failed')
     AND (NEW.runner_id LIKE 'auto-heal-%' OR NEW.runner_id LIKE 'repair-%' OR NEW.runner_id LIKE 'publish-repair-%') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'LEASE_GUARD: package % has status=% — only building packages can acquire leases', NEW.package_id, v_status;
END;
$$;

-- 2) Extend stale QGF reconciler to also handle publish_failed
CREATE OR REPLACE FUNCTION public.trg_reconcile_stale_quality_gate_failed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved_q_count integer;
  v_curriculum_id uuid;
  v_has_failed_lessons boolean := false;
BEGIN
  -- Only act on quality_gate_failed or publish_failed packages
  IF NEW.status NOT IN ('quality_gate_failed', 'publish_failed') THEN
    RETURN NEW;
  END IF;

  -- Must have integrity + council
  IF NOT COALESCE(NEW.integrity_passed, false) OR NOT COALESCE(NEW.council_approved, false) THEN
    RETURN NEW;
  END IF;

  -- Check approved question count
  v_curriculum_id := NEW.curriculum_id;
  IF v_curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_approved_q_count
  FROM exam_questions
  WHERE curriculum_id = v_curriculum_id
    AND status = 'approved';

  IF v_approved_q_count < 100 THEN
    RETURN NEW;
  END IF;

  -- For publish_failed: also check if there are still failed lessons
  IF NEW.status = 'publish_failed' THEN
    SELECT EXISTS(
      SELECT 1 FROM lessons l
      JOIN modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
      WHERE c.id = NEW.course_id
        AND l.status = 'draft'
        AND l.qc_status IN ('tier1_failed', 'needs_revision')
    ) INTO v_has_failed_lessons;

    IF v_has_failed_lessons THEN
      RETURN NEW; -- Still has failed lessons, don't auto-promote
    END IF;
  END IF;

  -- All gates green — promote to published
  NEW.status := 'published';
  NEW.published_at := COALESCE(NEW.published_at, now());

  -- Log the reconciliation
  INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_id, target_type, metadata)
  VALUES ('stale_qgf_reconciliation', 'trg_reconcile_stale_quality_gate_failed', 'success',
    format('Auto-promoted from %s to published — all gates green', OLD.status),
    NEW.id::text, 'course_package',
    jsonb_build_object('integrity_passed', NEW.integrity_passed, 'council_approved', NEW.council_approved,
      'approved_questions', v_approved_q_count, 'previous_status', OLD.status));

  RETURN NEW;
END;
$$;

-- 3) Function to detect packages eligible for publish recovery
CREATE OR REPLACE FUNCTION public.fn_detect_publish_recovery_eligible(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_failed_lessons jsonb;
  v_failed_count integer;
BEGIN
  SELECT id, status, course_id, integrity_passed, council_approved, curriculum_id
  INTO v_pkg FROM course_packages WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'package_not_found');
  END IF;

  -- Find failed lessons
  SELECT jsonb_agg(jsonb_build_object(
    'lesson_id', l.id,
    'title', l.title,
    'qc_status', l.qc_status
  )), count(*)
  INTO v_failed_lessons, v_failed_count
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = v_pkg.course_id
    AND l.status = 'draft'
    AND l.qc_status IN ('tier1_failed', 'needs_revision');

  RETURN jsonb_build_object(
    'eligible', v_failed_count > 0,
    'failed_lesson_count', v_failed_count,
    'failed_lessons', COALESCE(v_failed_lessons, '[]'::jsonb),
    'integrity_passed', COALESCE(v_pkg.integrity_passed, false),
    'council_approved', COALESCE(v_pkg.council_approved, false),
    'package_status', v_pkg.status
  );
END;
$$;

-- 4) Update ops views that filter on quality_gate_failed to include publish_failed
-- (non_building_recoverable, blocked_packages, etc.)

-- 5) Add publish_failed to the reaper exclusion for repair jobs
-- The reaper cancels jobs for non-building packages. Allow publish_failed packages
-- to keep their repair jobs alive.
