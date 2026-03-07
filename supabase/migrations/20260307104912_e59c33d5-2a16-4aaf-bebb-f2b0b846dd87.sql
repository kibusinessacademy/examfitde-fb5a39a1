
-- Fix 1: guard_ghost_step_finalization — exempt dispatcher-driven steps (generate_learning_content)
CREATE OR REPLACE FUNCTION guard_ghost_step_finalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only guard transitions TO 'done' or 'failed'
  IF NEW.status NOT IN ('done', 'failed') THEN RETURN NEW; END IF;
  -- Allow metadata updates on already-finalized steps
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Dispatcher-driven steps: external orchestrator updates meta but doesn't set started_at.
  -- These steps rely on artifact truth (needs_regen=0) instead of started_at.
  IF NEW.step_key IN ('generate_learning_content') THEN RETURN NEW; END IF;

  -- Block if step was never started (started_at IS NULL)
  -- Exception: steps explicitly approved via exception_approved
  IF NEW.started_at IS NULL AND NOT COALESCE(NEW.exception_approved, false) THEN
    RAISE EXCEPTION 'GHOST_FINALIZATION_BLOCKED: step "%" cannot be marked "%" — started_at IS NULL, attempts=%, package=%',
      NEW.step_key, NEW.status, NEW.attempts, NEW.package_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix 2: guard_learning_content_step_done — exclude mini_check from broken count (SSOT alignment with scheduler)
CREATE OR REPLACE FUNCTION guard_learning_content_step_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_course_id uuid;
  v_broken_count integer;
BEGIN
  -- Only guard generate_learning_content step transitions to 'done'
  IF NEW.step_key != 'generate_learning_content' THEN
    RETURN NEW;
  END IF;
  IF NEW.status != 'done' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'done' THEN
    RETURN NEW; -- already done, allow updates to meta etc.
  END IF;

  -- Look up course_id from package
  SELECT cp.course_id INTO v_course_id
  FROM course_packages cp
  WHERE cp.id = NEW.package_id;

  IF v_course_id IS NULL THEN
    RETURN NEW; -- no course found, allow (edge case)
  END IF;

  -- Count broken lessons (content NULL, placeholder, tier1_failed, regenerating)
  -- IMPORTANT: Exclude mini_check step — aligned with scheduler's NEEDS_REGEN_OR_FILTER scope
  SELECT count(*) INTO v_broken_count
  FROM modules m
  JOIN lessons l ON l.module_id = m.id
  WHERE m.course_id = v_course_id
    AND l.step != 'mini_check'
    AND (
      l.content IS NULL
      OR l.content->>'_placeholder' = 'true'
      OR l.qc_status = 'tier1_failed'
      OR l.content->>'_regenerating' = 'true'
    );

  IF v_broken_count > 0 THEN
    RAISE EXCEPTION 'GUARD_LEARNING_CONTENT_DONE: Cannot mark step done — % broken lessons remain (content NULL/placeholder/tier1_failed/regenerating)', v_broken_count;
  END IF;

  RETURN NEW;
END;
$$;
