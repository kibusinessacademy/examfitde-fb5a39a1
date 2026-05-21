
CREATE TABLE IF NOT EXISTS public.competency_weights (
  competency_id uuid PRIMARY KEY REFERENCES public.competencies(id) ON DELETE CASCADE,
  curriculum_id uuid,
  exam_weight_pct numeric NOT NULL DEFAULT 0,
  difficulty smallint NOT NULL DEFAULT 3,
  expected_practice_minutes int NOT NULL DEFAULT 30,
  prerequisite_competency_ids uuid[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competency_weights_difficulty_chk CHECK (difficulty BETWEEN 1 AND 5),
  CONSTRAINT competency_weights_weight_chk CHECK (exam_weight_pct BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_competency_weights_curriculum
  ON public.competency_weights (curriculum_id);

ALTER TABLE public.competency_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cw_admin_read" ON public.competency_weights FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "cw_service_write" ON public.competency_weights TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_curriculum_difficulty_map AS
SELECT
  cw.curriculum_id,
  COUNT(*)                            AS competencies_total,
  SUM(cw.exam_weight_pct)             AS total_exam_weight_pct,
  ROUND(AVG(cw.difficulty)::numeric,2) AS avg_difficulty,
  COUNT(*) FILTER (WHERE cw.difficulty >= 4) AS hard_competencies,
  COUNT(*) FILTER (WHERE cw.difficulty <= 2) AS easy_competencies,
  SUM(cw.expected_practice_minutes)   AS total_expected_minutes
FROM public.competency_weights cw
WHERE cw.curriculum_id IS NOT NULL
GROUP BY cw.curriculum_id;

REVOKE ALL ON public.v_curriculum_difficulty_map FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_curriculum_difficulty_map TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_competency_weights(p_curriculum_id uuid DEFAULT NULL)
RETURNS TABLE(competency_id uuid, curriculum_id uuid, exam_weight_pct numeric,
  difficulty smallint, expected_practice_minutes int,
  prerequisite_competency_ids uuid[], source text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT competency_id, curriculum_id, exam_weight_pct, difficulty,
         expected_practice_minutes, prerequisite_competency_ids, source, updated_at
  FROM public.competency_weights
  WHERE public.has_role(auth.uid(),'admin'::app_role)
    AND (p_curriculum_id IS NULL OR curriculum_id = p_curriculum_id)
  ORDER BY exam_weight_pct DESC, difficulty DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_competency_weights(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_competency_weights(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_competency_weight(
  p_competency_id uuid,
  p_curriculum_id uuid,
  p_exam_weight_pct numeric,
  p_difficulty smallint,
  p_expected_practice_minutes int DEFAULT 30,
  p_prerequisite_competency_ids uuid[] DEFAULT '{}',
  p_source text DEFAULT 'admin_ui',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  INSERT INTO public.competency_weights AS cw
    (competency_id, curriculum_id, exam_weight_pct, difficulty,
     expected_practice_minutes, prerequisite_competency_ids, source, notes)
  VALUES (p_competency_id, p_curriculum_id, p_exam_weight_pct, p_difficulty,
          p_expected_practice_minutes, p_prerequisite_competency_ids, p_source, p_notes)
  ON CONFLICT (competency_id) DO UPDATE
    SET curriculum_id = EXCLUDED.curriculum_id,
        exam_weight_pct = EXCLUDED.exam_weight_pct,
        difficulty = EXCLUDED.difficulty,
        expected_practice_minutes = EXCLUDED.expected_practice_minutes,
        prerequisite_competency_ids = EXCLUDED.prerequisite_competency_ids,
        source = EXCLUDED.source,
        notes = COALESCE(EXCLUDED.notes, cw.notes),
        updated_at = now()
  RETURNING competency_id INTO v_id;

  PERFORM public.fn_emit_audit(
    _action_type := 'competency_weight_upserted',
    _target_id   := v_id::text,
    _payload     := jsonb_build_object(
      'competency_id', v_id, 'curriculum_id', p_curriculum_id,
      'exam_weight_pct', p_exam_weight_pct, 'difficulty', p_difficulty,
      'source', p_source));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_competency_weight(uuid,uuid,numeric,smallint,int,uuid[],text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_competency_weight(uuid,uuid,numeric,smallint,int,uuid[],text,text) TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('competency_weight_upserted',
        ARRAY['competency_id','exam_weight_pct','difficulty','source'],
        'curriculum_intelligence')
ON CONFLICT (action_type) DO NOTHING;
