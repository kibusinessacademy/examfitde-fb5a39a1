-- Wave 3: MASTERY ENGINE (complete, single migration)

-- 1) Tables
CREATE TABLE IF NOT EXISTS public.user_competency_progress (
  user_id uuid NOT NULL,
  competency_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  mastery_level text NOT NULL DEFAULT 'not_mastered'
    CHECK (mastery_level IN ('not_mastered','partial','mastered')),
  score numeric NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1),
  attempts int NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, competency_id)
);

CREATE INDEX IF NOT EXISTS idx_ucp_user_curriculum ON public.user_competency_progress(user_id, curriculum_id);
CREATE INDEX IF NOT EXISTS idx_ucp_mastery_level ON public.user_competency_progress(mastery_level) WHERE mastery_level != 'mastered';

ALTER TABLE public.user_competency_progress ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_competency_progress' AND policyname = 'Users can read own mastery') THEN
    CREATE POLICY "Users can read own mastery" ON public.user_competency_progress FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_competency_progress' AND policyname = 'Users can insert own mastery') THEN
    CREATE POLICY "Users can insert own mastery" ON public.user_competency_progress FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_competency_progress' AND policyname = 'Users can update own mastery') THEN
    CREATE POLICY "Users can update own mastery" ON public.user_competency_progress FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT ALL ON public.user_competency_progress TO service_role;

CREATE TABLE IF NOT EXISTS public.readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  mastery_pct numeric NOT NULL DEFAULT 0,
  last_sim_score numeric,
  readiness_score numeric NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'high' CHECK (risk_level IN ('low','medium','high')),
  competency_count int NOT NULL DEFAULT 0,
  mastered_count int NOT NULL DEFAULT 0,
  partial_count int NOT NULL DEFAULT 0,
  weak_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readiness_user_curriculum ON public.readiness_snapshots(user_id, curriculum_id, created_at DESC);

ALTER TABLE public.readiness_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'readiness_snapshots' AND policyname = 'Users can read own readiness') THEN
    CREATE POLICY "Users can read own readiness" ON public.readiness_snapshots FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

GRANT ALL ON public.readiness_snapshots TO service_role;

-- 2) View
CREATE OR REPLACE VIEW public.v_user_weakness_map AS
SELECT ucp.user_id, ucp.curriculum_id, ucp.competency_id,
  c.title AS competency_title, lf.title AS learning_field_title, lf.sort_order,
  ucp.mastery_level, ucp.score, ucp.attempts, ucp.last_updated
FROM public.user_competency_progress ucp
JOIN public.competencies c ON c.id = ucp.competency_id
JOIN public.learning_fields lf ON lf.id = c.learning_field_id
WHERE ucp.mastery_level != 'mastered'
ORDER BY ucp.score ASC, lf.sort_order;

ALTER VIEW public.v_user_weakness_map SET (security_invoker = on);

-- 3) RPCs
CREATE OR REPLACE FUNCTION public.update_mastery_from_minicheck(
  p_user_id uuid, p_competency_id uuid, p_curriculum_id uuid, p_score numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_level text; old_level text;
BEGIN
  new_level := CASE WHEN p_score >= 0.8 THEN 'mastered' WHEN p_score >= 0.5 THEN 'partial' ELSE 'not_mastered' END;
  SELECT mastery_level INTO old_level FROM public.user_competency_progress WHERE user_id = p_user_id AND competency_id = p_competency_id;
  INSERT INTO public.user_competency_progress (user_id, competency_id, curriculum_id, mastery_level, score, attempts, last_updated)
  VALUES (p_user_id, p_competency_id, p_curriculum_id, new_level, p_score, 1, now())
  ON CONFLICT (user_id, competency_id) DO UPDATE SET
    mastery_level = new_level, score = p_score, curriculum_id = p_curriculum_id,
    attempts = user_competency_progress.attempts + 1, last_updated = now();
  RETURN jsonb_build_object('competency_id',p_competency_id,'old_level',COALESCE(old_level,'none'),'new_level',new_level,'score',p_score,'level_changed',COALESCE(old_level,'none') IS DISTINCT FROM new_level);
END; $$;

CREATE OR REPLACE FUNCTION public.get_adaptive_exam_questions(
  p_user_id uuid, p_curriculum_id uuid, p_limit int DEFAULT 40
) RETURNS TABLE(question_id uuid, competency_id uuid, difficulty text, mastery_level text, selection_weight int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.competency_id, q.difficulty,
    COALESCE(ucp.mastery_level, 'not_mastered'),
    CASE WHEN COALESCE(ucp.mastery_level,'not_mastered')='not_mastered' THEN 1 WHEN ucp.mastery_level='partial' THEN 2 ELSE 3 END
  FROM public.exam_questions q
  LEFT JOIN public.user_competency_progress ucp ON ucp.user_id = p_user_id AND ucp.competency_id = q.competency_id
  WHERE q.curriculum_id = p_curriculum_id AND q.status = 'approved'
  ORDER BY CASE WHEN COALESCE(ucp.mastery_level,'not_mastered')='not_mastered' THEN 1 WHEN ucp.mastery_level='partial' THEN 2 ELSE 3 END, random()
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.compute_readiness(p_user_id uuid, p_curriculum_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_mastered int; v_partial int; v_weak int;
  v_mastery_pct numeric; v_last_sim_score numeric; v_readiness numeric; v_risk text;
  v_last_snapshot record; v_should_persist boolean := false;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE mastery_level='mastered'), COUNT(*) FILTER (WHERE mastery_level='partial'), COUNT(*) FILTER (WHERE mastery_level='not_mastered')
  INTO v_total, v_mastered, v_partial, v_weak FROM public.user_competency_progress WHERE user_id=p_user_id AND curriculum_id=p_curriculum_id;
  IF v_total=0 THEN RETURN jsonb_build_object('readiness_score',0,'risk_level','high','mastery_pct',0,'last_sim_score',null,'mastered',0,'partial',0,'weak',0,'total',0,'persisted',false); END IF;
  v_mastery_pct := round((v_mastered + v_partial*0.5)*100.0/v_total, 1);
  SELECT score INTO v_last_sim_score FROM public.exam_attempts WHERE user_id=p_user_id ORDER BY completed_at DESC NULLS LAST LIMIT 1;
  v_readiness := round(v_mastery_pct*0.7 + COALESCE(v_last_sim_score,0)*0.3, 1);
  v_risk := CASE WHEN v_readiness>=75 THEN 'low' WHEN v_readiness>=50 THEN 'medium' ELSE 'high' END;
  SELECT * INTO v_last_snapshot FROM public.readiness_snapshots WHERE user_id=p_user_id AND curriculum_id=p_curriculum_id ORDER BY created_at DESC LIMIT 1;
  IF v_last_snapshot IS NULL THEN v_should_persist:=true;
  ELSIF v_last_snapshot.risk_level IS DISTINCT FROM v_risk THEN v_should_persist:=true;
  ELSIF abs(v_last_snapshot.readiness_score-v_readiness)>=1 THEN v_should_persist:=true;
  ELSIF v_last_snapshot.mastered_count IS DISTINCT FROM v_mastered OR v_last_snapshot.weak_count IS DISTINCT FROM v_weak THEN v_should_persist:=true;
  END IF;
  IF v_should_persist THEN
    INSERT INTO public.readiness_snapshots(user_id,curriculum_id,mastery_pct,last_sim_score,readiness_score,risk_level,competency_count,mastered_count,partial_count,weak_count)
    VALUES(p_user_id,p_curriculum_id,v_mastery_pct,v_last_sim_score,v_readiness,v_risk,v_total,v_mastered,v_partial,v_weak);
  END IF;
  RETURN jsonb_build_object('readiness_score',v_readiness,'risk_level',v_risk,'mastery_pct',v_mastery_pct,'last_sim_score',v_last_sim_score,'mastered',v_mastered,'partial',v_partial,'weak',v_weak,'total',v_total,'persisted',v_should_persist);
END; $$;