
-- ============================================================
-- Council 4 Phase 2: Duplicate Gates + Approved View + Guards
-- ============================================================

-- 1) normalized_hash column for duplicate prevention
ALTER TABLE public.exam_questions
ADD COLUMN IF NOT EXISTS normalized_hash text;

-- 2) Normalization + hash functions (pgcrypto already available)
CREATE OR REPLACE FUNCTION public.normalize_question_text(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(lower(coalesce(p_text,'')), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.compute_question_hash(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT encode(digest(public.normalize_question_text(p_text), 'sha256'), 'hex');
$$;

-- 3) Auto-fill hash trigger
CREATE OR REPLACE FUNCTION public.trg_fill_exam_question_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.normalized_hash := public.compute_question_hash(NEW.question_text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_exam_questions_fill_hash ON public.exam_questions;
CREATE TRIGGER trg_exam_questions_fill_hash
BEFORE INSERT OR UPDATE OF question_text
ON public.exam_questions
FOR EACH ROW EXECUTE FUNCTION public.trg_fill_exam_question_hash();

-- 4) Backfill existing rows
UPDATE public.exam_questions
SET normalized_hash = public.compute_question_hash(question_text)
WHERE normalized_hash IS NULL;

-- 5) Unique index: same blueprint + same normalized hash = duplicate
CREATE UNIQUE INDEX IF NOT EXISTS exam_questions_unique_blueprint_hash
ON public.exam_questions(blueprint_id, normalized_hash)
WHERE blueprint_id IS NOT NULL AND normalized_hash IS NOT NULL;

-- 6) Approved-only view (SSOT for all question consumers)
CREATE OR REPLACE VIEW public.v_exam_questions_approved AS
SELECT *
FROM public.exam_questions
WHERE status = 'approved';

-- 7) Guard: questions can only be inserted if their blueprint is approved
CREATE OR REPLACE FUNCTION public.guard_exam_question_blueprint_approved()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bp_status text;
BEGIN
  -- Allow NULL blueprint_id (legacy/migration)
  IF NEW.blueprint_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_bp_status FROM public.question_blueprints WHERE id = NEW.blueprint_id;
  IF v_bp_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Question blocked: blueprint % is not approved (status=%)', NEW.blueprint_id, v_bp_status;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_exam_question_bp ON public.exam_questions;
CREATE TRIGGER trg_guard_exam_question_bp
BEFORE INSERT ON public.exam_questions
FOR EACH ROW EXECUTE FUNCTION public.guard_exam_question_blueprint_approved();

-- 8) Weighted MiniCheck assembly RPC (uses competency weighting as proxy)
CREATE OR REPLACE FUNCTION public.assemble_minicheck_weighted(
  p_lesson_id uuid,
  p_course_id uuid,
  p_questions int DEFAULT 5
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_set_id uuid;
  v_curriculum_id uuid;
BEGIN
  -- Get curriculum_id from course
  SELECT curriculum_id INTO v_curriculum_id
  FROM public.courses WHERE id = p_course_id;

  -- Ensure set exists
  SELECT id INTO v_set_id FROM public.minicheck_sets WHERE lesson_id = p_lesson_id;
  IF v_set_id IS NULL THEN
    INSERT INTO public.minicheck_sets(course_id, lesson_id, status)
    VALUES (p_course_id, p_lesson_id, 'under_review')
    RETURNING id INTO v_set_id;
  ELSE
    DELETE FROM public.minicheck_set_items WHERE minicheck_set_id = v_set_id;
    UPDATE public.minicheck_sets SET status='under_review', updated_at=now() WHERE id = v_set_id;
  END IF;

  -- Weighted sampling: distribute across learning fields proportionally
  -- then fill remainder with random approved questions
  WITH lf_weights AS (
    SELECT lf.id AS lf_id,
           COUNT(c.id) AS comp_count
    FROM public.learning_fields lf
    LEFT JOIN public.competencies c ON c.learning_field_id = lf.id
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY lf.id
  ),
  total AS (
    SELECT COALESCE(SUM(comp_count), 1) AS total_comps FROM lf_weights
  ),
  quotas AS (
    SELECT lf_id,
           GREATEST(1, round((comp_count::numeric / total_comps) * p_questions)::int) AS quota
    FROM lf_weights, total
  ),
  picked AS (
    SELECT q.id, q.learning_field_id,
           row_number() OVER (PARTITION BY q.learning_field_id ORDER BY random()) AS rn
    FROM public.v_exam_questions_approved q
    WHERE q.curriculum_id = v_curriculum_id
  ),
  selected AS (
    SELECT p2.id
    FROM picked p2
    JOIN quotas qt ON qt.lf_id = p2.learning_field_id
    WHERE p2.rn <= qt.quota
    LIMIT p_questions
  ),
  fallback AS (
    SELECT q.id
    FROM public.v_exam_questions_approved q
    WHERE q.curriculum_id = v_curriculum_id
      AND q.id NOT IN (SELECT id FROM selected)
    ORDER BY random()
    LIMIT GREATEST(0, p_questions - (SELECT COUNT(*) FROM selected))
  ),
  final_pick AS (
    SELECT id FROM selected
    UNION ALL
    SELECT id FROM fallback
  )
  INSERT INTO public.minicheck_set_items(minicheck_set_id, exam_question_id, position)
  SELECT v_set_id, id, row_number() OVER (ORDER BY random())::int
  FROM final_pick;

  UPDATE public.minicheck_sets
  SET question_count = (SELECT COUNT(*) FROM public.minicheck_set_items WHERE minicheck_set_id = v_set_id),
      updated_at = now()
  WHERE id = v_set_id;

  RETURN v_set_id;
END $$;
