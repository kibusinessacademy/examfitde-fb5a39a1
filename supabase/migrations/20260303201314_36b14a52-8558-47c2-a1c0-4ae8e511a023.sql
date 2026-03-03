
-- ============================================================
-- Phase 1: Canonical Hashing + Advisory Dedup + Blueprint Targets
-- ============================================================

-- 1) Columns already added in failed migration, ensure they exist
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS canonical_hash text,
  ADD COLUMN IF NOT EXISTS global_canonical_hash text;

-- 2) Functions already created, recreate for safety
CREATE OR REPLACE FUNCTION public.compute_canonical_hash(
  p_competency_id uuid,
  p_cognitive_level text,
  p_difficulty text,
  p_scenario_type text,
  p_transfer_variant boolean,
  p_correct_answer integer,
  p_blueprint_id uuid
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public
AS $$
  SELECT encode(extensions.digest(concat_ws('|',
    COALESCE(p_competency_id::text,'_'), COALESCE(lower(p_cognitive_level),'_'),
    COALESCE(lower(p_difficulty),'_'), COALESCE(lower(p_scenario_type),'_'),
    COALESCE(p_transfer_variant::text,'false'), COALESCE(p_correct_answer::text,'_'),
    COALESCE(p_blueprint_id::text,'_')
  ), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.compute_global_canonical_hash(
  p_competency_id uuid,
  p_cognitive_level text,
  p_difficulty text,
  p_scenario_type text,
  p_transfer_variant boolean,
  p_correct_answer integer
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public
AS $$
  SELECT encode(extensions.digest(concat_ws('|',
    COALESCE(p_competency_id::text,'_'), COALESCE(lower(p_cognitive_level),'_'),
    COALESCE(lower(p_difficulty),'_'), COALESCE(lower(p_scenario_type),'_'),
    COALESCE(p_transfer_variant::text,'false'), COALESCE(p_correct_answer::text,'_')
  ), 'sha256'), 'hex');
$$;

-- 3) Trigger function
CREATE OR REPLACE FUNCTION public.trg_fill_canonical_hashes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.canonical_hash := public.compute_canonical_hash(
    NEW.competency_id, NEW.cognitive_level, NEW.difficulty::text,
    NEW.scenario_type, NEW.transfer_variant, NEW.correct_answer, NEW.blueprint_id
  );
  NEW.global_canonical_hash := public.compute_global_canonical_hash(
    NEW.competency_id, NEW.cognitive_level, NEW.difficulty::text,
    NEW.scenario_type, NEW.transfer_variant, NEW.correct_answer
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_questions_fill_canonical ON public.exam_questions;
CREATE TRIGGER trg_exam_questions_fill_canonical
  BEFORE INSERT OR UPDATE OF competency_id, cognitive_level, difficulty, scenario_type, transfer_variant, correct_answer, blueprint_id
  ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fill_canonical_hashes();

-- 4) Backfill
UPDATE public.exam_questions
SET
  canonical_hash = public.compute_canonical_hash(
    competency_id, cognitive_level, difficulty::text, scenario_type, transfer_variant, correct_answer, blueprint_id
  ),
  global_canonical_hash = public.compute_global_canonical_hash(
    competency_id, cognitive_level, difficulty::text, scenario_type, transfer_variant, correct_answer
  )
WHERE canonical_hash IS NULL;

-- 5) Advisory indexes (NOT unique — used for soft gates + density checks)
CREATE INDEX IF NOT EXISTS idx_exam_q_canonical
  ON public.exam_questions (blueprint_id, canonical_hash)
  WHERE canonical_hash IS NOT NULL AND status = 'approved';

CREATE INDEX IF NOT EXISTS idx_exam_q_global_canonical
  ON public.exam_questions (global_canonical_hash)
  WHERE global_canonical_hash IS NOT NULL AND status = 'approved';

-- ============================================================
-- Blueprint Targets: SSOT for target distribution per competency
-- ============================================================

CREATE TABLE IF NOT EXISTS public.blueprint_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES public.competencies(id) ON DELETE CASCADE,
  target_recall integer NOT NULL DEFAULT 2,
  target_application integer NOT NULL DEFAULT 4,
  target_scenario integer NOT NULL DEFAULT 3,
  target_transfer integer NOT NULL DEFAULT 1,
  target_error_patterns integer NOT NULL DEFAULT 2,
  target_total integer GENERATED ALWAYS AS (
    target_recall + target_application + target_scenario + target_transfer + target_error_patterns
  ) STORED,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (curriculum_id, competency_id)
);

ALTER TABLE public.blueprint_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage blueprint_targets"
  ON public.blueprint_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Coverage-Diff View: Soll vs. Ist pro Kompetenz
-- ============================================================

CREATE OR REPLACE VIEW public.ops_blueprint_coverage_diff AS
SELECT
  bt.curriculum_id,
  bt.competency_id,
  c.title AS competency_title,
  lf.title AS learning_field_title,
  bt.target_recall, bt.target_application, bt.target_scenario,
  bt.target_transfer, bt.target_error_patterns, bt.target_total,
  COUNT(eq.id) FILTER (WHERE eq.status='approved') AS actual_total,
  COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.cognitive_level='remember') AS actual_recall,
  COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.cognitive_level IN ('apply','understand')) AS actual_application,
  COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.scenario_type IS NOT NULL AND eq.scenario_type != 'isolated_knowledge') AS actual_scenario,
  COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.transfer_variant = true) AS actual_transfer,
  COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.scenario_type = 'error_detection') AS actual_error_patterns,
  bt.target_total - COUNT(eq.id) FILTER (WHERE eq.status='approved') AS gap_total,
  bt.target_recall - COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.cognitive_level='remember') AS gap_recall,
  bt.target_application - COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.cognitive_level IN ('apply','understand')) AS gap_application,
  bt.target_scenario - COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.scenario_type IS NOT NULL AND eq.scenario_type != 'isolated_knowledge') AS gap_scenario,
  bt.target_transfer - COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.transfer_variant = true) AS gap_transfer,
  bt.target_error_patterns - COUNT(eq.id) FILTER (WHERE eq.status='approved' AND eq.scenario_type = 'error_detection') AS gap_error_patterns,
  bt.priority
FROM public.blueprint_targets bt
JOIN public.competencies c ON c.id = bt.competency_id
JOIN public.learning_fields lf ON lf.id = c.learning_field_id
LEFT JOIN public.exam_questions eq ON eq.competency_id = bt.competency_id AND eq.curriculum_id = bt.curriculum_id
GROUP BY bt.id, bt.curriculum_id, bt.competency_id, c.title, lf.title,
  bt.target_recall, bt.target_application, bt.target_scenario,
  bt.target_transfer, bt.target_error_patterns, bt.target_total, bt.priority;

-- ============================================================
-- RPC: Coverage Gaps for Producer-Router
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_blueprint_coverage_gaps(
  p_curriculum_id uuid,
  p_min_gap integer DEFAULT 1
)
RETURNS TABLE (
  competency_id uuid, competency_title text, learning_field_title text,
  gap_total integer, gap_recall integer, gap_application integer,
  gap_scenario integer, gap_transfer integer, gap_error_patterns integer,
  priority integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d.competency_id, d.competency_title, d.learning_field_title,
    d.gap_total, d.gap_recall, d.gap_application,
    d.gap_scenario, d.gap_transfer, d.gap_error_patterns, d.priority
  FROM public.ops_blueprint_coverage_diff d
  WHERE d.curriculum_id = p_curriculum_id AND d.gap_total >= p_min_gap
  ORDER BY d.priority DESC, d.gap_total DESC;
$$;

-- ============================================================
-- RPC: Advisory canonical collision check (for generators)
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_canonical_collision(
  p_competency_id uuid, p_cognitive_level text, p_difficulty text,
  p_scenario_type text, p_transfer_variant boolean, p_correct_answer integer,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (collision_found boolean, colliding_question_id uuid, colliding_blueprint_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH target_hash AS (
    SELECT public.compute_global_canonical_hash(
      p_competency_id, p_cognitive_level, p_difficulty, p_scenario_type, p_transfer_variant, p_correct_answer
    ) AS h
  )
  SELECT true, eq.id, eq.blueprint_id
  FROM public.exam_questions eq, target_hash th
  WHERE eq.global_canonical_hash = th.h AND eq.status = 'approved'
    AND (p_exclude_id IS NULL OR eq.id != p_exclude_id)
  LIMIT 1;
$$;

-- ============================================================
-- RPC: Canonical density check (max N items per canonical bucket per blueprint)
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_canonical_density(
  p_blueprint_id uuid,
  p_canonical_hash text,
  p_max_per_bucket integer DEFAULT 5
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*) < p_max_per_bucket
  FROM public.exam_questions
  WHERE blueprint_id = p_blueprint_id
    AND canonical_hash = p_canonical_hash
    AND status = 'approved';
$$;
