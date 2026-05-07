
DO $$ BEGIN
  CREATE TYPE public.humor_level AS ENUM ('engagement','memory','insider','scenario','reinforcement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.humor_exam_phase AS ENUM ('pre_exam','learning','post_error','general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.humor_items
  ADD COLUMN IF NOT EXISTS humor_level         public.humor_level,
  ADD COLUMN IF NOT EXISTS exam_phase          public.humor_exam_phase DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS learner_state       text,
  ADD COLUMN IF NOT EXISTS pain_point          text,
  ADD COLUMN IF NOT EXISTS didactic_goal       text,
  ADD COLUMN IF NOT EXISTS cognitive_pattern   text,
  ADD COLUMN IF NOT EXISTS persona_type        text,
  ADD COLUMN IF NOT EXISTS seasonality         text,
  ADD COLUMN IF NOT EXISTS pedagogical_score   numeric,
  ADD COLUMN IF NOT EXISTS exam_relevance_score_v2 numeric,
  ADD COLUMN IF NOT EXISTS retention_score     numeric;

-- LRS Generated Column (use _v2 to avoid collision with existing exam_relevance text col)
ALTER TABLE public.humor_items
  ADD COLUMN IF NOT EXISTS learning_reinforcement_score numeric
    GENERATED ALWAYS AS (
      ROUND(
        (COALESCE(quality_score,0) * 0.20
       + COALESCE(pedagogical_score,0) * 0.30
       + COALESCE(exam_relevance_score_v2,0) * 0.30
       + COALESCE(retention_score,0) * 0.20)::numeric, 2)
    ) STORED;

CREATE TABLE IF NOT EXISTS public.humor_qc_gate_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  humor_item_id uuid REFERENCES public.humor_items(id) ON DELETE CASCADE,
  gate_code text NOT NULL,
  reason text,
  attempted_status text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_humor_qc_gate_violations_item ON public.humor_qc_gate_violations(humor_item_id);
CREATE INDEX IF NOT EXISTS idx_humor_qc_gate_violations_gate ON public.humor_qc_gate_violations(gate_code, created_at DESC);
ALTER TABLE public.humor_qc_gate_violations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read humor gate violations" ON public.humor_qc_gate_violations;
CREATE POLICY "admins read humor gate violations" ON public.humor_qc_gate_violations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.fn_guard_humor_competency_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('approved'::humor_status, 'frozen'::humor_status)
     AND NEW.competence_id IS NULL THEN
    INSERT INTO public.humor_qc_gate_violations (humor_item_id, gate_code, reason, attempted_status)
    VALUES (NEW.id, 'HUMOR_NO_COMPETENCY_LINK',
            'Humor-Item ohne competence_id darf nicht approved werden', NEW.status::text);
    RAISE EXCEPTION 'HUMOR_NO_COMPETENCY_LINK: item % kann ohne competence_id nicht auf % gesetzt werden', NEW.id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_humor_competency_link ON public.humor_items;
CREATE TRIGGER trg_guard_humor_competency_link
  BEFORE INSERT OR UPDATE OF status, competence_id ON public.humor_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_humor_competency_link();

DROP VIEW IF EXISTS public.v_admin_humor_qc;
CREATE VIEW public.v_admin_humor_qc AS
WITH base AS (
  SELECT hi.certification_id, c.title AS certification_title,
         hi.status, hi.humor_type::text AS humor_type,
         hi.humor_level::text AS humor_level,
         hi.exam_phase::text AS exam_phase,
         hi.quality_score, hi.learning_reinforcement_score,
         hi.competence_id, hi.lesson_id, hi.blueprint_id,
         lower(regexp_replace(hi.text, '[^a-zäöüß0-9 ]','', 'gi')) AS norm_text
  FROM humor_items hi
  LEFT JOIN certifications c ON c.id = hi.certification_id
), stats AS (
  SELECT certification_id, certification_title,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status IN ('approved','frozen')) AS approved_count,
    COUNT(*) FILTER (WHERE status='draft')    AS draft_count,
    COUNT(*) FILTER (WHERE status='rejected') AS rejected_count,
    ROUND(AVG(quality_score), 2) AS avg_quality,
    ROUND(AVG(learning_reinforcement_score), 2) AS avg_lrs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE competence_id IS NULL)::numeric
                / NULLIF(COUNT(*),0)::numeric, 1) AS pct_no_competence,
    ROUND(100.0 * COUNT(*) FILTER (WHERE lesson_id IS NULL)::numeric
                / NULLIF(COUNT(*),0)::numeric, 1) AS pct_no_lesson,
    ROUND(100.0 * COUNT(*) FILTER (WHERE blueprint_id IS NULL)::numeric
                / NULLIF(COUNT(*),0)::numeric, 1) AS pct_no_blueprint,
    COUNT(*) FILTER (WHERE status IN ('approved','frozen') AND competence_id IS NULL) AS hard_gate_violations
  FROM base GROUP BY certification_id, certification_title
), type_counts AS (
  SELECT certification_id, jsonb_object_agg(humor_type, cnt) AS type_distribution
  FROM (SELECT certification_id, humor_type, COUNT(*) cnt FROM base
        WHERE status IN ('approved','frozen') GROUP BY 1,2) t GROUP BY 1
), level_counts AS (
  SELECT certification_id, jsonb_object_agg(COALESCE(humor_level,'unset'), cnt) AS level_distribution
  FROM (SELECT certification_id, humor_level, COUNT(*) cnt FROM base
        WHERE status IN ('approved','frozen') GROUP BY 1,2) t GROUP BY 1
), phase_counts AS (
  SELECT certification_id, jsonb_object_agg(COALESCE(exam_phase,'unset'), cnt) AS phase_distribution
  FROM (SELECT certification_id, exam_phase, COUNT(*) cnt FROM base
        WHERE status IN ('approved','frozen') GROUP BY 1,2) t GROUP BY 1
), dupes AS (
  SELECT certification_id, COUNT(*) AS duplicate_suspect_count
  FROM (SELECT certification_id, norm_text, COUNT(*) c FROM base
        WHERE status IN ('approved','frozen') GROUP BY 1,2 HAVING COUNT(*)>1) d
  GROUP BY 1
)
SELECT s.certification_id, s.certification_title,
       s.total, s.approved_count, s.draft_count, s.rejected_count,
       s.avg_quality, s.avg_lrs,
       s.pct_no_competence, s.pct_no_lesson, s.pct_no_blueprint,
       s.hard_gate_violations,
       COALESCE(tc.type_distribution,'{}'::jsonb) AS type_distribution,
       COALESCE(lc.level_distribution,'{}'::jsonb) AS level_distribution,
       COALESCE(pc.phase_distribution,'{}'::jsonb) AS phase_distribution,
       COALESCE(d.duplicate_suspect_count,0) AS duplicate_suspect_count
FROM stats s
LEFT JOIN type_counts tc ON tc.certification_id = s.certification_id
LEFT JOIN level_counts lc ON lc.certification_id = s.certification_id
LEFT JOIN phase_counts pc ON pc.certification_id = s.certification_id
LEFT JOIN dupes d ON d.certification_id = s.certification_id
ORDER BY s.approved_count DESC;
