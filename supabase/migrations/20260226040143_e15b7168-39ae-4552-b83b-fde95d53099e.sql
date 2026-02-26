
-- ============================================================
-- Blueprint v2 Elite-Score Schema + LF-Policy + Aggregation
-- ============================================================

-- 1) elite_level enum (distractor_error_type already exists)
DO $$ BEGIN
  CREATE TYPE public.elite_level AS ENUM ('standard','advanced','elite');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Extend exam_questions with Elite-Score columns
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS elite_level public.elite_level,
  ADD COLUMN IF NOT EXISTS complexity_score int,
  ADD COLUMN IF NOT EXISTS multi_variable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS conflict_type text,
  ADD COLUMN IF NOT EXISTS dynamic_scenario boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_variant boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS distractor_types text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS elite_score int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS elite_score_breakdown jsonb DEFAULT '{}'::jsonb;

-- 3) Indexes for aggregation
CREATE INDEX IF NOT EXISTS idx_exam_q_elite_score ON public.exam_questions(elite_score);
CREATE INDEX IF NOT EXISTS idx_exam_q_elite_level ON public.exam_questions(elite_level);

-- 4) LF Elite Policy Table (SSOT: per Certification + Learning Field)
CREATE TABLE IF NOT EXISTS public.learning_field_elite_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  learning_field_id uuid NOT NULL,

  min_elite_ratio numeric NOT NULL DEFAULT 0.30,
  min_evaluate_ratio numeric NOT NULL DEFAULT 0.15,
  max_knowledge_ratio numeric NOT NULL DEFAULT 0.20,
  min_multi_variable_ratio numeric NOT NULL DEFAULT 0.25,
  min_conflict_ratio numeric NOT NULL DEFAULT 0.15,
  min_transfer_ratio numeric NOT NULL DEFAULT 0.10,
  require_distractor_diversity boolean NOT NULL DEFAULT true,
  min_distractor_types int NOT NULL DEFAULT 3,
  is_core boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (certification_id, learning_field_id)
);

ALTER TABLE public.learning_field_elite_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on lf_elite_policies"
  ON public.learning_field_elite_policies FOR ALL
  USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_lf_policy_touch ON public.learning_field_elite_policies;
CREATE TRIGGER trg_lf_policy_touch
BEFORE UPDATE ON public.learning_field_elite_policies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5) Elite-Score compute function
CREATE OR REPLACE FUNCTION public.compute_elite_score(
  p_cognitive_level text,
  p_complexity_score int,
  p_multi_variable boolean,
  p_conflict_type text,
  p_dynamic_scenario boolean,
  p_transfer_variant boolean,
  p_distractor_types text[]
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  s int := 0;
  bd jsonb := '{}'::jsonb;
  is_eval boolean := (p_cognitive_level IN ('evaluate','analyze'));
  dcount int := COALESCE(array_length(p_distractor_types, 1), 0);
  has_conflict boolean := (p_conflict_type IS NOT NULL AND p_conflict_type <> '' AND p_conflict_type <> 'none');
BEGIN
  IF COALESCE(p_multi_variable, false) THEN s := s + 2; bd := bd || '{"multi_variable":2}'::jsonb;
  ELSE bd := bd || '{"multi_variable":0}'::jsonb; END IF;

  IF has_conflict THEN s := s + 2; bd := bd || '{"conflict_type":2}'::jsonb;
  ELSE bd := bd || '{"conflict_type":0}'::jsonb; END IF;

  IF COALESCE(p_dynamic_scenario, false) THEN s := s + 1; bd := bd || '{"dynamic_scenario":1}'::jsonb;
  ELSE bd := bd || '{"dynamic_scenario":0}'::jsonb; END IF;

  IF COALESCE(p_transfer_variant, false) THEN s := s + 1; bd := bd || '{"transfer_variant":1}'::jsonb;
  ELSE bd := bd || '{"transfer_variant":0}'::jsonb; END IF;

  IF dcount >= 3 THEN s := s + 2; bd := bd || jsonb_build_object('distractor_diversity', 2, 'distractor_type_count', dcount);
  ELSE bd := bd || jsonb_build_object('distractor_diversity', 0, 'distractor_type_count', dcount); END IF;

  IF is_eval THEN s := s + 2; bd := bd || '{"cognitive_level":2}'::jsonb;
  ELSE bd := bd || '{"cognitive_level":0}'::jsonb; END IF;

  bd := bd || jsonb_build_object('complexity_score_ok', COALESCE(p_complexity_score, 0) >= 4);

  RETURN jsonb_build_object('score', s, 'breakdown', bd);
END $$;

-- 6) Trigger: auto-compute elite_score on insert/update
CREATE OR REPLACE FUNCTION public.trg_set_elite_score()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r jsonb;
  sc int;
BEGIN
  r := public.compute_elite_score(
    NEW.cognitive_level::text,
    NEW.complexity_score,
    NEW.multi_variable,
    NEW.conflict_type,
    NEW.dynamic_scenario,
    NEW.transfer_variant,
    COALESCE(NEW.distractor_types, '{}'::text[])
  );

  sc := (r->>'score')::int;
  NEW.elite_score = sc;
  NEW.elite_score_breakdown = r->'breakdown';

  -- Auto-derive elite_level if not explicitly set
  IF NEW.elite_level IS NULL THEN
    NEW.elite_level :=
      CASE
        WHEN sc >= 7 AND COALESCE(NEW.complexity_score, 0) >= 4 THEN 'elite'::public.elite_level
        WHEN sc >= 5 THEN 'advanced'::public.elite_level
        ELSE 'standard'::public.elite_level
      END;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_exam_questions_elite_score ON public.exam_questions;
CREATE TRIGGER trg_exam_questions_elite_score
BEFORE INSERT OR UPDATE OF cognitive_level, complexity_score, multi_variable, conflict_type, dynamic_scenario, transfer_variant, distractor_types, elite_level
ON public.exam_questions
FOR EACH ROW EXECUTE FUNCTION public.trg_set_elite_score();

-- 7) Aggregation View: per Package × Learning Field
CREATE OR REPLACE VIEW public.v_exam_pool_lf_elite_agg AS
SELECT
  q.curriculum_id,
  q.learning_field_id,
  count(*) as total_questions,
  count(*) FILTER (WHERE q.status = 'approved') as approved_questions,
  count(*) FILTER (WHERE q.elite_level = 'elite') as elite_questions,
  count(*) FILTER (WHERE q.cognitive_level = 'evaluate') as evaluate_cnt,
  count(*) FILTER (WHERE q.cognitive_level IN ('remember','understand')) as knowledge_cnt,
  count(*) FILTER (WHERE COALESCE(q.multi_variable, false) = true) as multivar_cnt,
  count(*) FILTER (WHERE q.conflict_type IS NOT NULL AND q.conflict_type <> '' AND q.conflict_type <> 'none') as conflict_cnt,
  count(*) FILTER (WHERE COALESCE(q.transfer_variant, false) = true) as transfer_cnt,
  count(*) FILTER (WHERE COALESCE(array_length(q.distractor_types, 1), 0) >= 3) as distractor_diverse_cnt,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE q.elite_level = 'elite'))::numeric / count(*), 4) END as elite_ratio,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE q.cognitive_level = 'evaluate'))::numeric / count(*), 4) END as evaluate_ratio,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE q.cognitive_level IN ('remember','understand')))::numeric / count(*), 4) END as knowledge_ratio,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE COALESCE(q.multi_variable, false) = true))::numeric / count(*), 4) END as multi_variable_ratio,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE q.conflict_type IS NOT NULL AND q.conflict_type <> '' AND q.conflict_type <> 'none'))::numeric / count(*), 4) END as conflict_ratio,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE COALESCE(q.transfer_variant, false) = true))::numeric / count(*), 4) END as transfer_ratio,
  CASE WHEN count(*) = 0 THEN 0 ELSE round((count(*) FILTER (WHERE COALESCE(array_length(q.distractor_types, 1), 0) >= 3))::numeric / count(*), 4) END as distractor_diversity_ratio
FROM public.exam_questions q
GROUP BY q.curriculum_id, q.learning_field_id;

-- 8) Council Audit RPC: audit_lf_elite_policy
CREATE OR REPLACE FUNCTION public.audit_lf_elite_policy(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
  pol record;
  violations jsonb := '[]'::jsonb;
  any_fail boolean := false;
  cert_id uuid;
BEGIN
  -- Resolve certification_id from curriculum
  SELECT certification_id INTO cert_id
  FROM public.course_packages WHERE curriculum_id = p_curriculum_id LIMIT 1;

  IF cert_id IS NULL THEN
    RETURN jsonb_build_object('passed', true, 'violations', '[]'::jsonb, 'note', 'no_certification_found');
  END IF;

  FOR rec IN
    SELECT * FROM public.v_exam_pool_lf_elite_agg
    WHERE curriculum_id = p_curriculum_id
  LOOP
    SELECT * INTO pol
    FROM public.learning_field_elite_policies
    WHERE certification_id = cert_id
      AND learning_field_id = rec.learning_field_id;

    IF pol IS NULL THEN
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id,
        'status', 'warning', 'reason', 'NO_POLICY_DEFINED'
      ));
      CONTINUE;
    END IF;

    -- Check each rule
    IF rec.elite_ratio < pol.min_elite_ratio THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'min_elite_ratio', 'expected', pol.min_elite_ratio, 'actual', rec.elite_ratio, 'is_core', pol.is_core
      ));
    END IF;

    IF rec.evaluate_ratio < pol.min_evaluate_ratio THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'min_evaluate_ratio', 'expected', pol.min_evaluate_ratio, 'actual', rec.evaluate_ratio, 'is_core', pol.is_core
      ));
    END IF;

    IF rec.knowledge_ratio > pol.max_knowledge_ratio THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'max_knowledge_ratio', 'expected', pol.max_knowledge_ratio, 'actual', rec.knowledge_ratio, 'is_core', pol.is_core
      ));
    END IF;

    IF rec.multi_variable_ratio < pol.min_multi_variable_ratio THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'min_multi_variable_ratio', 'expected', pol.min_multi_variable_ratio, 'actual', rec.multi_variable_ratio, 'is_core', pol.is_core
      ));
    END IF;

    IF rec.conflict_ratio < pol.min_conflict_ratio THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'min_conflict_ratio', 'expected', pol.min_conflict_ratio, 'actual', rec.conflict_ratio, 'is_core', pol.is_core
      ));
    END IF;

    IF rec.transfer_ratio < pol.min_transfer_ratio THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'min_transfer_ratio', 'expected', pol.min_transfer_ratio, 'actual', rec.transfer_ratio, 'is_core', pol.is_core
      ));
    END IF;

    IF pol.require_distractor_diversity AND rec.distractor_diversity_ratio < 0.80 THEN
      any_fail := true;
      violations := violations || jsonb_build_array(jsonb_build_object(
        'learning_field_id', rec.learning_field_id, 'status', 'fail',
        'rule', 'distractor_diversity', 'expected', 0.80, 'actual', rec.distractor_diversity_ratio, 'is_core', pol.is_core
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'passed', NOT any_fail,
    'violations', violations,
    'violations_count', jsonb_array_length(violations),
    'curriculum_id', p_curriculum_id
  );
END $$;

-- Grants
REVOKE ALL ON FUNCTION public.audit_lf_elite_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_lf_elite_policy(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_lf_elite_policy(uuid) TO authenticated;
