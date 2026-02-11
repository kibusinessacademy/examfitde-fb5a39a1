
-- =============================================================
-- LAYER 1: DATABASE INTEGRITY - Cleanup orphans + Unique Constraints
-- =============================================================

-- 1a) Clean up orphan lessons (no valid module)
DELETE FROM lessons WHERE module_id IN (
  SELECT m.id FROM modules m
  LEFT JOIN courses c ON c.id = m.course_id
  WHERE c.id IS NULL
);

-- 1b) Clean up orphan modules (no valid course)
DELETE FROM modules WHERE course_id NOT IN (SELECT id FROM courses);

-- 1c) Deduplicate remaining lessons: keep oldest per (module_id, competency_id, step)
DELETE FROM lessons WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY module_id, competency_id, step 
      ORDER BY created_at ASC, id ASC
    ) as rn
    FROM lessons
    WHERE competency_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

-- 1d) Deduplicate remaining modules: reassign lessons then delete extras
-- First reassign lessons from duplicate modules to the canonical (oldest) one
WITH canonical AS (
  SELECT DISTINCT ON (course_id, learning_field_id) 
    id as keep_id, course_id, learning_field_id
  FROM modules
  WHERE learning_field_id IS NOT NULL
  ORDER BY course_id, learning_field_id, created_at ASC, id ASC
),
dupes AS (
  SELECT m.id as dupe_id, c.keep_id
  FROM modules m
  JOIN canonical c ON c.course_id = m.course_id AND c.learning_field_id = m.learning_field_id
  WHERE m.id != c.keep_id AND m.learning_field_id IS NOT NULL
)
UPDATE lessons SET module_id = dupes.keep_id
FROM dupes WHERE lessons.module_id = dupes.dupe_id;

-- Now delete the duplicate modules
DELETE FROM modules WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY course_id, learning_field_id 
      ORDER BY created_at ASC, id ASC
    ) as rn
    FROM modules
    WHERE learning_field_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

-- 1e) Add UNIQUE constraints
ALTER TABLE lessons
  ADD CONSTRAINT uq_lesson_module_comp_step 
  UNIQUE (module_id, competency_id, step);

ALTER TABLE modules
  ADD CONSTRAINT uq_module_course_lf 
  UNIQUE (course_id, learning_field_id);

-- =============================================================
-- LAYER 3: JOB-LOCK TABLE
-- =============================================================
CREATE TABLE IF NOT EXISTS public.course_generation_locks (
  course_id UUID PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT
);

ALTER TABLE public.course_generation_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for generation locks"
  ON public.course_generation_locks
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- =============================================================
-- LAYER 4: validate_course_integrity RPC
-- =============================================================
CREATE OR REPLACE FUNCTION public.validate_course_integrity(p_course_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_comps INTEGER;
  v_expected_lessons INTEGER;
  v_actual_lessons INTEGER;
  v_actual_modules INTEGER;
  v_expected_modules INTEGER;
  v_duplicate_lessons INTEGER;
  v_missing_minichecks INTEGER;
  v_issues JSONB := '[]'::JSONB;
  v_passed BOOLEAN := TRUE;
BEGIN
  -- Count competencies linked to the course's curriculum
  SELECT COUNT(DISTINCT comp.id)
  INTO v_total_comps
  FROM courses c
  JOIN learning_fields lf ON lf.curriculum_id = c.curriculum_id
  JOIN competencies comp ON comp.learning_field_id = lf.id
  WHERE c.id = p_course_id;

  v_expected_lessons := v_total_comps * 5;

  -- Count actual lessons
  SELECT COUNT(*)
  INTO v_actual_lessons
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id;

  -- Count actual modules vs expected (learning fields)
  SELECT COUNT(*) INTO v_actual_modules
  FROM modules WHERE course_id = p_course_id;

  SELECT COUNT(DISTINCT lf.id) INTO v_expected_modules
  FROM courses c
  JOIN learning_fields lf ON lf.curriculum_id = c.curriculum_id
  WHERE c.id = p_course_id;

  -- Check for duplicate lessons
  SELECT COUNT(*) INTO v_duplicate_lessons
  FROM (
    SELECT module_id, competency_id, step
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = p_course_id AND l.competency_id IS NOT NULL
    GROUP BY module_id, competency_id, step
    HAVING COUNT(*) > 1
  ) sub;

  -- Check missing mini_checks
  SELECT COUNT(*) INTO v_missing_minichecks
  FROM competencies comp
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  JOIN courses c ON c.curriculum_id = lf.curriculum_id
  WHERE c.id = p_course_id
  AND NOT EXISTS (
    SELECT 1 FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = p_course_id
    AND l.competency_id = comp.id
    AND l.step = 'mini_check'
  );

  -- Build issues array
  IF v_actual_lessons != v_expected_lessons THEN
    v_passed := FALSE;
    v_issues := v_issues || jsonb_build_object(
      'type', 'lesson_count_mismatch',
      'expected', v_expected_lessons,
      'actual', v_actual_lessons,
      'severity', 'critical'
    );
  END IF;

  IF v_actual_modules != v_expected_modules THEN
    v_passed := FALSE;
    v_issues := v_issues || jsonb_build_object(
      'type', 'module_count_mismatch',
      'expected', v_expected_modules,
      'actual', v_actual_modules,
      'severity', 'critical'
    );
  END IF;

  IF v_duplicate_lessons > 0 THEN
    v_passed := FALSE;
    v_issues := v_issues || jsonb_build_object(
      'type', 'duplicate_lessons',
      'count', v_duplicate_lessons,
      'severity', 'critical'
    );
  END IF;

  IF v_missing_minichecks > 0 THEN
    v_passed := FALSE;
    v_issues := v_issues || jsonb_build_object(
      'type', 'missing_minichecks',
      'count', v_missing_minichecks,
      'severity', 'warning'
    );
  END IF;

  -- Auto-unpublish if integrity fails
  IF NOT v_passed THEN
    UPDATE courses 
    SET publishing_status = 'integrity_error',
        status = CASE WHEN status = 'published' THEN 'draft' ELSE status END
    WHERE id = p_course_id 
    AND (publishing_status = 'published' OR status = 'published');
  END IF;

  RETURN jsonb_build_object(
    'course_id', p_course_id,
    'passed', v_passed,
    'expected_competencies', v_total_comps,
    'expected_lessons', v_expected_lessons,
    'actual_lessons', v_actual_lessons,
    'expected_modules', v_expected_modules,
    'actual_modules', v_actual_modules,
    'duplicate_lessons', v_duplicate_lessons,
    'missing_minichecks', v_missing_minichecks,
    'issues', v_issues,
    'validated_at', now()
  );
END;
$$;
