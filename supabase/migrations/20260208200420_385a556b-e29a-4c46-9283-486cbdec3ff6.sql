-- ============================================
-- GAP ANALYSIS IMPLEMENTATION: Schema Update (Fixed)
-- ============================================

-- 1. Learner Diagnostics (Diagnosetest-Ergebnisse)
CREATE TABLE IF NOT EXISTS public.learner_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  curriculum_id UUID REFERENCES curricula NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  results JSONB NOT NULL DEFAULT '[]',
  exam_date DATE,
  weekly_time_minutes INTEGER DEFAULT 300,
  focus_areas TEXT[] DEFAULT '{}',
  recommended_path TEXT CHECK (recommended_path IN ('course_first', 'exam_trainer', 'mixed')),
  estimated_readiness_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);

-- 2. Readiness Scores (Bestehens-Prognose)
CREATE TABLE IF NOT EXISTS public.readiness_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  curriculum_id UUID REFERENCES curricula NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT now(),
  overall_readiness NUMERIC(5,2) DEFAULT 0,
  predicted_exam_score NUMERIC(5,2) DEFAULT 0,
  weak_areas JSONB DEFAULT '[]',
  strong_areas JSONB DEFAULT '[]',
  trend TEXT CHECK (trend IN ('improving', 'stable', 'declining')),
  days_until_ready INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_readiness_user_curriculum ON public.readiness_scores(user_id, curriculum_id, calculated_at DESC);

-- 3. Erweitere exam_sessions um weakness mode
ALTER TABLE public.exam_sessions
ADD COLUMN IF NOT EXISTS target_competencies UUID[] DEFAULT NULL;

-- 4. RLS Policies
ALTER TABLE public.learner_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.readiness_scores ENABLE ROW LEVEL SECURITY;

-- Learner Diagnostics Policies
DROP POLICY IF EXISTS "Users can view own diagnostics" ON public.learner_diagnostics;
CREATE POLICY "Users can view own diagnostics" 
ON public.learner_diagnostics FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own diagnostics" ON public.learner_diagnostics;
CREATE POLICY "Users can insert own diagnostics" 
ON public.learner_diagnostics FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own diagnostics" ON public.learner_diagnostics;
CREATE POLICY "Users can update own diagnostics" 
ON public.learner_diagnostics FOR UPDATE 
USING (auth.uid() = user_id);

-- Readiness Scores Policies
DROP POLICY IF EXISTS "Users can view own readiness scores" ON public.readiness_scores;
CREATE POLICY "Users can view own readiness scores" 
ON public.readiness_scores FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own readiness scores" ON public.readiness_scores;
CREATE POLICY "Users can insert own readiness scores" 
ON public.readiness_scores FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- 5. Funktion zur Berechnung der Bestehens-Prognose
CREATE OR REPLACE FUNCTION public.calculate_readiness_score(p_user_id UUID, p_curriculum_id UUID)
RETURNS TABLE (
  overall_readiness NUMERIC,
  predicted_exam_score NUMERIC,
  weak_areas JSONB,
  strong_areas JSONB,
  trend TEXT,
  days_until_ready INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_score NUMERIC := 0;
  v_course_mastery NUMERIC := 0;
  v_weak JSONB := '[]';
  v_strong JSONB := '[]';
  v_trend TEXT := 'stable';
  v_days INTEGER := 30;
BEGIN
  -- Durchschnittliche Prüfungsleistung der letzten Sessions
  SELECT COALESCE(AVG(es.score_percentage), 0)
  INTO v_exam_score
  FROM exam_sessions es
  WHERE es.user_id = p_user_id
    AND es.curriculum_id = p_curriculum_id
    AND es.finished_at IS NOT NULL
    AND es.finished_at > NOW() - INTERVAL '30 days';
  
  -- Mastery aus Lektionen
  SELECT COALESCE(
    (COUNT(CASE WHEN lo.mastery_status = 'mastered' THEN 1 END)::NUMERIC / 
     NULLIF(COUNT(*)::NUMERIC, 0)) * 100, 0
  )
  INTO v_course_mastery
  FROM lesson_outcomes lo
  JOIN lessons l ON l.id = lo.lesson_id
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  WHERE lo.user_id = p_user_id
    AND c.curriculum_id = p_curriculum_id;
  
  -- Berechne Gesamtscore (gewichtet)
  overall_readiness := (v_exam_score * 0.6) + (v_course_mastery * 0.4);
  predicted_exam_score := v_exam_score;
  weak_areas := v_weak;
  strong_areas := v_strong;
  trend := v_trend;
  days_until_ready := GREATEST(0, CEIL((50 - overall_readiness) / 2)::INTEGER);
  
  RETURN NEXT;
END;
$$;

-- 6. Funktion für adaptive Empfehlungen
CREATE OR REPLACE FUNCTION public.get_adaptive_recommendation(p_user_id UUID, p_curriculum_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weak_count INTEGER;
  v_last_exam_score NUMERIC;
  v_has_diagnostic BOOLEAN;
  v_exam_date DATE;
  v_days_until_exam INTEGER;
  v_result JSONB;
BEGIN
  -- Check ob Diagnosetest gemacht wurde
  SELECT EXISTS(
    SELECT 1 FROM learner_diagnostics 
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
  ) INTO v_has_diagnostic;
  
  IF NOT v_has_diagnostic THEN
    RETURN jsonb_build_object(
      'action', 'DIAGNOSTIC',
      'reason', 'Starte mit einem Diagnosetest für personalisierte Empfehlungen',
      'route', '/diagnostic/' || p_curriculum_id,
      'priority', 'high'
    );
  END IF;
  
  -- Prüfungsdatum
  SELECT exam_date INTO v_exam_date
  FROM learner_diagnostics
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;
  
  IF v_exam_date IS NOT NULL THEN
    v_days_until_exam := v_exam_date - CURRENT_DATE;
  END IF;
  
  -- Anzahl schwacher Kompetenzen
  SELECT COUNT(*) INTO v_weak_count
  FROM (
    SELECT esq.competency_code
    FROM exam_session_questions esq
    JOIN exam_sessions es ON es.id = esq.exam_session_id
    WHERE es.user_id = p_user_id AND es.curriculum_id = p_curriculum_id
    GROUP BY esq.competency_code
    HAVING AVG(CASE WHEN esq.is_correct THEN 100 ELSE 0 END) < 70
  ) sub;
  
  -- Letzte Prüfungsleistung
  SELECT score_percentage INTO v_last_exam_score
  FROM exam_sessions
  WHERE user_id = p_user_id 
    AND curriculum_id = p_curriculum_id
    AND finished_at IS NOT NULL
  ORDER BY finished_at DESC
  LIMIT 1;
  
  -- Adaptive Logik
  IF v_weak_count > 3 THEN
    v_result := jsonb_build_object(
      'action', 'COURSE',
      'reason', 'Mehrere Wissenslücken erkannt. Vertiefen empfohlen.',
      'route', '/courses',
      'priority', 'high',
      'weak_count', v_weak_count
    );
  ELSIF v_last_exam_score IS NOT NULL AND v_last_exam_score > 75 THEN
    v_result := jsonb_build_object(
      'action', 'SIMULATION',
      'reason', 'Gute Leistung! Zeit für Prüfungssimulation.',
      'route', '/exam-simulation',
      'priority', 'medium'
    );
  ELSIF v_days_until_exam IS NOT NULL AND v_days_until_exam < 14 THEN
    v_result := jsonb_build_object(
      'action', 'ORAL_TRAINER',
      'reason', 'Prüfung naht! Mündliche Vorbereitung priorisieren.',
      'route', '/oral-exam',
      'priority', 'high',
      'days_until_exam', v_days_until_exam
    );
  ELSIF v_weak_count > 0 THEN
    v_result := jsonb_build_object(
      'action', 'WEAKNESS_MODE',
      'reason', 'Gezieltes Training für schwache Bereiche.',
      'route', '/exam-simulation?mode=weakness',
      'priority', 'medium',
      'weak_count', v_weak_count
    );
  ELSE
    v_result := jsonb_build_object(
      'action', 'CONTINUE',
      'reason', 'Weiter so! Fortschritt ist gut.',
      'route', '/dashboard',
      'priority', 'low'
    );
  END IF;
  
  RETURN v_result;
END;
$$;

-- 7. Funktion zum Starten einer Schwächen-Session
CREATE OR REPLACE FUNCTION public.start_weakness_exam_session(
  p_blueprint_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_user_id UUID := auth.uid();
  v_curriculum_id UUID;
  v_weak_competencies UUID[];
BEGIN
  -- Get curriculum from blueprint
  SELECT curriculum_id INTO v_curriculum_id
  FROM exam_blueprints WHERE id = p_blueprint_id;
  
  -- Finde schwache Kompetenzen (Score < 70%)
  SELECT ARRAY_AGG(comp.id) INTO v_weak_competencies
  FROM (
    SELECT esq.competency_code
    FROM exam_session_questions esq
    JOIN exam_sessions es ON es.id = esq.exam_session_id
    WHERE es.user_id = v_user_id AND es.curriculum_id = v_curriculum_id
    GROUP BY esq.competency_code
    HAVING AVG(CASE WHEN esq.is_correct THEN 100 ELSE 0 END) < 70
  ) sub
  JOIN competencies comp ON comp.code = sub.competency_code;
  
  -- Erstelle Session mit weakness mode
  INSERT INTO exam_sessions (
    user_id, 
    curriculum_id, 
    blueprint_id, 
    mode, 
    seed,
    total_questions,
    target_competencies
  )
  SELECT 
    v_user_id,
    curriculum_id,
    id,
    'weakness',
    FLOOR(RANDOM() * 2147483647)::INTEGER,
    LEAST(total_questions, 20),
    v_weak_competencies
  FROM exam_blueprints
  WHERE id = p_blueprint_id
  RETURNING id INTO v_session_id;
  
  -- Selektiere nur Fragen aus schwachen Kompetenzen
  INSERT INTO exam_session_questions (
    exam_session_id,
    question_id,
    order_index,
    difficulty,
    learning_field_code,
    competency_code
  )
  SELECT 
    v_session_id,
    eq.id,
    ROW_NUMBER() OVER (ORDER BY RANDOM()) - 1,
    eq.difficulty,
    eq.learning_field_code,
    eq.competency_code
  FROM exam_questions eq
  JOIN competencies comp ON comp.code = eq.competency_code
  WHERE eq.curriculum_id = v_curriculum_id
    AND comp.id = ANY(v_weak_competencies)
  ORDER BY RANDOM()
  LIMIT 20;
  
  RETURN v_session_id;
END;
$$;