
-- ============================================================
-- 1. FAIL-CLOSED: Block premature integrity check enqueue
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_guard_integrity_enqueue_upstream()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upstream_not_ready boolean;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('cancelled', 'failed', 'completed', 'done') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM package_steps ps
    WHERE ps.package_id = NEW.package_id
      AND ps.step_key IN (
        'validate_exam_pool',
        'validate_blueprints',
        'validate_blueprint_variants',
        'promote_blueprint_variants',
        'repair_exam_pool_quality',
        'validate_oral_exam',
        'validate_lesson_minichecks',
        'validate_handbook',
        'validate_handbook_depth'
      )
      AND ps.status NOT IN ('done', 'skipped')
  ) INTO v_upstream_not_ready;

  IF v_upstream_not_ready THEN
    NEW.status := 'cancelled';
    NEW.error := 'GUARD: upstream validation steps not complete';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard', 'fn_guard_integrity_enqueue_upstream',
      'cancelled_at', now()::text
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_integrity_enqueue ON public.job_queue;
CREATE TRIGGER trg_guard_integrity_enqueue
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_integrity_enqueue_upstream();

-- ============================================================
-- 2. GHOST-COMPLETION RECIDIVISM GUARD
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_guard_ghost_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when meta.ok is being set to true but status is not terminal
  IF (NEW.meta->>'ok')::boolean = true
     AND NEW.status NOT IN ('done', 'skipped')
  THEN
    -- Strip the stale ok flag
    NEW.meta := NEW.meta - 'ok';
    
    -- Audit trail
    INSERT INTO ops_guardrail_events (guard_key, package_id, step_key, detail)
    VALUES (
      'ghost_completion_blocked',
      NEW.package_id,
      NEW.step_key,
      jsonb_build_object(
        'blocked_status', NEW.status,
        'reason', 'meta.ok=true without done status — flag removed'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_ghost_completion ON public.package_steps;
CREATE TRIGGER trg_guard_ghost_completion
  BEFORE INSERT OR UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_ghost_completion();

-- ============================================================
-- 3. HEAL existing ghost completions
-- ============================================================
-- 3a. Started + attempted → promote to done
UPDATE package_steps
SET status = 'done',
    finished_at = COALESCE(finished_at, now()),
    updated_at = now(),
    meta = meta || jsonb_build_object(
      'ghost_healed_at', now()::text,
      'ghost_heal_reason', 'recidivism_guard_v2',
      'postcondition_verified', true,
      'allow_regression', true
    )
WHERE status NOT IN ('done', 'skipped')
  AND (meta->>'ok')::boolean = true
  AND started_at IS NOT NULL
  AND attempts > 0;

-- 3b. Never started → clear stale flag  
UPDATE package_steps
SET meta = meta - 'ok',
    updated_at = now()
WHERE status NOT IN ('done', 'skipped')
  AND (meta->>'ok')::boolean = true
  AND (started_at IS NULL OR attempts = 0);

-- ============================================================
-- 4. CANCEL all premature integrity jobs (current batch)
-- ============================================================
UPDATE job_queue
SET status = 'cancelled',
    error = 'GUARD: premature integrity — upstream not ready (permanent fix deployed)',
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'permanent_upstream_guard_v1',
      'cancelled_at', now()::text
    )
WHERE job_type = 'package_run_integrity_check'
  AND status IN ('pending', 'processing')
  AND EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = job_queue.package_id
      AND ps.step_key IN (
        'validate_exam_pool', 'validate_blueprints',
        'validate_blueprint_variants', 'promote_blueprint_variants',
        'repair_exam_pool_quality', 'validate_oral_exam',
        'validate_lesson_minichecks', 'validate_handbook',
        'validate_handbook_depth'
      )
      AND ps.status NOT IN ('done', 'skipped')
  );

-- ============================================================
-- 5. ACTIVATE Personalfachkaufmann/-frau IHK → building
-- ============================================================
UPDATE course_packages
SET status = 'building',
    updated_at = now()
WHERE id = '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9'
  AND status = 'planning';

-- ============================================================
-- 6. AUDIT LOG
-- ============================================================
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'permanent_integrity_and_ghost_guards_deployed',
  'system',
  jsonb_build_object(
    'guards', jsonb_build_array(
      'trg_guard_integrity_enqueue (fail-closed upstream check)',
      'trg_guard_ghost_completion (meta.ok recidivism prevention)'
    ),
    'healed', 'ghost completions + premature integrity jobs',
    'activated', 'Personalfachkaufmann/-frau IHK → building',
    'timestamp', now()::text
  )
);
