
-- ═══════════════════════════════════════════════════════════════════════
-- P0 FIX: Fail-closed guard for auto_seed_exam_blueprints step
-- Prevents step from being marked 'done' when 0 blueprints exist
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_blueprint_step_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_bp_count integer;
BEGIN
  -- Only fire when auto_seed_exam_blueprints transitions to 'done'
  IF NEW.step_key <> 'auto_seed_exam_blueprints' THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'done' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'done' THEN
    RETURN NEW; -- already done, idempotent
  END IF;

  -- Resolve curriculum_id
  SELECT curriculum_id INTO v_curriculum_id
  FROM course_packages
  WHERE id = NEW.package_id;

  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'BLUEPRINT_GUARD: no curriculum_id for package %', NEW.package_id;
  END IF;

  -- Check SSOT table (question_blueprints, NOT exam_blueprints)
  SELECT count(*) INTO v_bp_count
  FROM question_blueprints
  WHERE curriculum_id = v_curriculum_id;

  IF v_bp_count < 1 THEN
    -- Fail-closed: reject transition to done, force failed status
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_BLUEPRINTS_MATERIALIZED: guard rejected done with 0 blueprints in question_blueprints';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text,
      'guard_name', 'guard_blueprint_step_done',
      'blueprint_count', v_bp_count
    );
    RAISE WARNING 'BLUEPRINT_GUARD: rejected done for package % — 0 blueprints', NEW.package_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_guard_blueprint_step_done ON package_steps;
CREATE TRIGGER trg_guard_blueprint_step_done
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION guard_blueprint_step_done();

-- ═══════════════════════════════════════════════════════════════════════
-- RECONCILE: Fix steps falsely marked 'done' with 0 blueprints
-- Reset to 'queued' so they can be re-dispatched
-- ═══════════════════════════════════════════════════════════════════════

UPDATE package_steps ps
SET 
  status = 'queued',
  started_at = NULL,
  finished_at = NULL,
  last_error = 'RECONCILE: reset by P0 blueprint fix — was done with 0 blueprints',
  meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
    'reconciled_at', now()::text,
    'reconcile_reason', 'ZERO_BLUEPRINTS_FALSE_DONE',
    'previous_status', ps.status
  ),
  updated_at = now()
FROM course_packages cp
WHERE ps.package_id = cp.id
  AND ps.step_key = 'auto_seed_exam_blueprints'
  AND ps.status = 'done'
  AND cp.status IN ('building', 'queued', 'blocked')
  AND (SELECT count(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id) = 0;
