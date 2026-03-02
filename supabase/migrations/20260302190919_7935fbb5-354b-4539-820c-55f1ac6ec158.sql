
-- 1) Backfill any remaining NULLs from course relationship
UPDATE course_packages cp
SET curriculum_id = c.curriculum_id
FROM courses c
WHERE cp.course_id = c.id
AND cp.curriculum_id IS NULL
AND c.curriculum_id IS NOT NULL;

-- 2) Trigger guard: BEFORE INSERT/UPDATE — auto-fill curriculum_id from course if missing, hard-fail if still NULL
CREATE OR REPLACE FUNCTION guard_package_curriculum_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Auto-fill from course if missing
  IF NEW.curriculum_id IS NULL AND NEW.course_id IS NOT NULL THEN
    SELECT curriculum_id INTO NEW.curriculum_id
    FROM courses WHERE id = NEW.course_id;
  END IF;

  -- Hard guard: curriculum_id MUST be set
  IF NEW.curriculum_id IS NULL THEN
    RAISE EXCEPTION 'OPS_GUARD:PACKAGE_CURRICULUM_REQUIRED: course_packages.curriculum_id must not be NULL (package_id=%, course_id=%)',
      NEW.id, NEW.course_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_package_curriculum_id
  BEFORE INSERT OR UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION guard_package_curriculum_id();

-- 3) Now safe to enforce NOT NULL
ALTER TABLE course_packages
  ALTER COLUMN curriculum_id SET NOT NULL;
