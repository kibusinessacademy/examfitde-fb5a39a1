
-- Annotation table: approved questions get annotations HERE, not in exam_questions
CREATE TABLE IF NOT EXISTS public.exam_question_elite_annotations (
  question_id uuid PRIMARY KEY REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  curriculum_id uuid NOT NULL,
  run_id text,
  elite_level public.elite_level,
  multi_variable boolean NOT NULL DEFAULT false,
  transfer_variant boolean NOT NULL DEFAULT false,
  distractor_types text[] NOT NULL DEFAULT '{}'::text[],
  elite_score int NOT NULL DEFAULT 0,
  elite_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  annotated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eqea_curriculum_idx
  ON public.exam_question_elite_annotations(curriculum_id);

ALTER TABLE public.exam_question_elite_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on elite annotations"
  ON public.exam_question_elite_annotations
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- View: merges annotations with exam_questions for audit/export
CREATE OR REPLACE VIEW public.exam_questions_elite_v AS
SELECT
  q.*,
  COALESCE(a.elite_level, q.elite_level) AS elite_level_eff,
  COALESCE(a.multi_variable, q.multi_variable, false) AS multi_variable_eff,
  COALESCE(a.transfer_variant, q.transfer_variant, false) AS transfer_variant_eff,
  COALESCE(a.distractor_types, q.distractor_types, '{}'::text[]) AS distractor_types_eff,
  COALESCE(a.elite_score, 0) AS elite_score_eff,
  a.elite_breakdown AS elite_breakdown,
  a.annotated_at AS annotation_ts
FROM public.exam_questions q
LEFT JOIN public.exam_question_elite_annotations a
  ON a.question_id = q.id;
