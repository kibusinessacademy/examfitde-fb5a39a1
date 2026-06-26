
-- 1) Schema-Erweiterung
ALTER TABLE public.oral_exam_questions
  ADD COLUMN IF NOT EXISTS topic_key text,
  ADD COLUMN IF NOT EXISTS topic_label text;

ALTER TABLE public.oral_exam_sessions
  ADD COLUMN IF NOT EXISTS topic_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS topic_filter text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS idx_oral_exam_questions_session_topic
  ON public.oral_exam_questions(session_id, topic_key);

-- 2) Auto-Derivation Function: leitet Thema aus Lernfeld oder Kompetenz ab
CREATE OR REPLACE FUNCTION public.oral_exam_question_fill_topic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_title text;
  v_lf_id uuid;
BEGIN
  -- Already set? Keep as SSOT.
  IF NEW.topic_key IS NOT NULL AND NEW.topic_label IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve learning_field: prefer explicit, else via competency
  v_lf_id := NEW.learning_field_id;
  IF v_lf_id IS NULL AND NEW.competency_id IS NOT NULL THEN
    SELECT learning_field_id INTO v_lf_id
    FROM public.competencies WHERE id = NEW.competency_id;
  END IF;

  IF v_lf_id IS NOT NULL THEN
    SELECT code, title INTO v_code, v_title
    FROM public.learning_fields WHERE id = v_lf_id;

    IF NEW.topic_key IS NULL THEN
      NEW.topic_key := COALESCE(v_code, v_lf_id::text);
    END IF;
    IF NEW.topic_label IS NULL THEN
      NEW.topic_label := COALESCE(v_title, v_code, 'Allgemein');
    END IF;
    IF NEW.learning_field_id IS NULL THEN
      NEW.learning_field_id := v_lf_id;
    END IF;
  ELSE
    NEW.topic_key   := COALESCE(NEW.topic_key, 'allgemein');
    NEW.topic_label := COALESCE(NEW.topic_label, 'Allgemein');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oral_exam_question_fill_topic ON public.oral_exam_questions;
CREATE TRIGGER trg_oral_exam_question_fill_topic
  BEFORE INSERT OR UPDATE OF learning_field_id, competency_id, topic_key, topic_label
  ON public.oral_exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.oral_exam_question_fill_topic();

-- 3) Backfill bestehender Fragen
WITH src AS (
  SELECT q.id,
         COALESCE(lf_q.code, lf_c.code)   AS code,
         COALESCE(lf_q.title, lf_c.title) AS title,
         COALESCE(lf_q.id,    lf_c.id)    AS lf_id
  FROM public.oral_exam_questions q
  LEFT JOIN public.learning_fields lf_q ON lf_q.id = q.learning_field_id
  LEFT JOIN public.competencies c       ON c.id   = q.competency_id
  LEFT JOIN public.learning_fields lf_c ON lf_c.id = c.learning_field_id
  WHERE q.topic_key IS NULL OR q.topic_label IS NULL
)
UPDATE public.oral_exam_questions q
   SET topic_key        = COALESCE(q.topic_key,   src.code,  src.lf_id::text, 'allgemein'),
       topic_label      = COALESCE(q.topic_label, src.title, src.code,        'Allgemein'),
       learning_field_id = COALESCE(q.learning_field_id, src.lf_id)
  FROM src WHERE src.id = q.id;

-- 4) Auswertungs-View pro Thema
CREATE OR REPLACE VIEW public.v_oral_exam_topic_scores AS
SELECT
  q.session_id,
  COALESCE(q.topic_key, 'allgemein')   AS topic_key,
  COALESCE(q.topic_label, 'Allgemein') AS topic_label,
  COUNT(*)::int                                                AS questions_total,
  COUNT(q.user_answer)::int                                    AS questions_answered,
  ROUND(AVG(q.fachlichkeit_score)       * 100, 1)              AS fachlichkeit_pct,
  ROUND(AVG(q.struktur_score)           * 100, 1)              AS struktur_pct,
  ROUND(AVG(q.begriffssicherheit_score) * 100, 1)              AS begriffssicherheit_pct,
  ROUND(AVG(q.praxisbezug_score)        * 100, 1)              AS praxisbezug_pct,
  ROUND((
      COALESCE(AVG(q.fachlichkeit_score),0)       * 0.35
    + COALESCE(AVG(q.struktur_score),0)           * 0.20
    + COALESCE(AVG(q.begriffssicherheit_score),0) * 0.25
    + COALESCE(AVG(q.praxisbezug_score),0)        * 0.20
  ) * 100, 1) AS overall_pct
FROM public.oral_exam_questions q
GROUP BY q.session_id, q.topic_key, q.topic_label;

GRANT SELECT ON public.v_oral_exam_topic_scores TO authenticated, service_role;
