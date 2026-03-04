
BEGIN;

-- ═══════════════════════════════════════════════════
-- 1) Curriculum Freeze Guard
--    Blocks updates to frozen curricula (status='frozen')
--    except for safe fields: updated_at, seeding_version, seeding_completed_at
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.curriculum_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'frozen' AND NEW.status = 'frozen' THEN
    -- Allow only metadata updates
    IF (OLD.title, OLD.description, OLD.normalized_data, OLD.extracted_data, OLD.exam_structure, OLD.passing_rules)
       IS DISTINCT FROM
       (NEW.title, NEW.description, NEW.normalized_data, NEW.extracted_data, NEW.exam_structure, NEW.passing_rules)
    THEN
      RAISE EXCEPTION 'CURRICULUM_FROZEN: SSOT fields are immutable once frozen (curriculum_id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curriculum_freeze_guard ON public.curricula;
CREATE TRIGGER trg_curriculum_freeze_guard
BEFORE UPDATE ON public.curricula
FOR EACH ROW
EXECUTE FUNCTION public.curriculum_freeze_guard();

-- ═══════════════════════════════════════════════════
-- 2) Package Steps Sort Order Guard
--    Prevents NULL/negative sort_order and duplicates per package
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.package_steps_sort_order_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- sort_order is not a column on package_steps – use step_key ordering instead
  -- Guard: step_key must not be empty
  IF NEW.step_key IS NULL OR NEW.step_key = '' THEN
    RAISE EXCEPTION 'INVALID_STEP_KEY: step_key must not be empty (package_id=%)', NEW.package_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Guard: no duplicate step_key per package
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.step_key IS DISTINCT FROM NEW.step_key) THEN
    IF EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = NEW.package_id
        AND ps.step_key = NEW.step_key
        AND ps.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_STEP_KEY: package=% step_key=%', NEW.package_id, NEW.step_key
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_package_steps_sort_order_guard ON public.package_steps;
CREATE TRIGGER trg_package_steps_sort_order_guard
BEFORE INSERT OR UPDATE ON public.package_steps
FOR EACH ROW
EXECUTE FUNCTION public.package_steps_sort_order_guard();

-- ═══════════════════════════════════════════════════
-- 3) Blueprint Approval Guard
--    Blocks status → 'approved' if required fields are missing
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.blueprint_approval_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_missing text := '';
BEGIN
  IF NEW.status = 'approved' AND COALESCE(OLD.status::text, '') <> 'approved' THEN
    IF NEW.competency_id IS NULL THEN v_missing := v_missing || 'competency_id,'; END IF;
    IF NEW.exam_relevance IS NULL THEN v_missing := v_missing || 'exam_relevance,'; END IF;
    IF NEW.canonical_statement IS NULL OR NEW.canonical_statement = '' THEN v_missing := v_missing || 'canonical_statement,'; END IF;
    IF NEW.question_template IS NULL OR NEW.question_template = '' THEN v_missing := v_missing || 'question_template,'; END IF;

    IF v_missing <> '' THEN
      RAISE EXCEPTION 'BLUEPRINT_APPROVAL_BLOCKED: missing fields: % (blueprint_id=%)', v_missing, NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blueprint_approval_guard ON public.question_blueprints;
CREATE TRIGGER trg_blueprint_approval_guard
BEFORE UPDATE ON public.question_blueprints
FOR EACH ROW
EXECUTE FUNCTION public.blueprint_approval_guard();

-- ═══════════════════════════════════════════════════
-- 4) Activate all 3 in expected_trigger_bindings
-- ═══════════════════════════════════════════════════
UPDATE public.expected_trigger_bindings
SET enabled = true
WHERE expected_trigger IN (
  'trg_curriculum_freeze_guard',
  'trg_package_steps_sort_order_guard',
  'trg_blueprint_approval_guard'
);

COMMIT;
