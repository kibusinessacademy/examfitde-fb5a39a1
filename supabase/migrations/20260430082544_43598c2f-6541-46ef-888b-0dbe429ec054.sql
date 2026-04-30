-- ============================================================
-- SYNTHETIC COHORT RUNNER — Read-only Validation Infrastructure
-- ============================================================

CREATE TABLE IF NOT EXISTS public.synth_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_key text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  target_accuracy numeric NOT NULL CHECK (target_accuracy >= 0 AND target_accuracy <= 1),
  response_speed_factor numeric NOT NULL DEFAULT 1.0,
  completion_rate numeric NOT NULL DEFAULT 1.0 CHECK (completion_rate >= 0 AND completion_rate <= 1),
  retry_rate numeric NOT NULL DEFAULT 0.0 CHECK (retry_rate >= 0 AND retry_rate <= 1),
  hint_usage_rate numeric NOT NULL DEFAULT 0.3,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.synth_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synth_personas_admin_read" ON public.synth_personas
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.synth_cohort_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  mode text NOT NULL DEFAULT 'heuristic_with_llm_gate',
  package_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  persona_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  packages_total int NOT NULL DEFAULT 0,
  packages_completed int NOT NULL DEFAULT 0,
  packages_with_findings int NOT NULL DEFAULT 0,
  llm_calls int NOT NULL DEFAULT 0,
  total_findings int NOT NULL DEFAULT 0,
  avg_didactic_score numeric,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.synth_cohort_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synth_cohort_runs_admin_all" ON public.synth_cohort_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_synth_cohort_runs_started ON public.synth_cohort_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_synth_cohort_runs_status ON public.synth_cohort_runs (status);

CREATE TABLE IF NOT EXISTS public.synth_session_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.synth_cohort_runs(id) ON DELETE CASCADE,
  package_id uuid NOT NULL,
  persona_key text NOT NULL,
  didactic_score numeric,
  question_quality_score numeric,
  ihk_coverage_score numeric,
  step_completeness_score numeric,
  simulated_accuracy numeric,
  simulated_completion_rate numeric,
  flagged_for_llm_review boolean NOT NULL DEFAULT false,
  llm_reviewed boolean NOT NULL DEFAULT false,
  raw_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.synth_session_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synth_session_results_admin_read" ON public.synth_session_results
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_synth_session_results_run ON public.synth_session_results (run_id);
CREATE INDEX IF NOT EXISTS idx_synth_session_results_pkg ON public.synth_session_results (package_id);

CREATE TABLE IF NOT EXISTS public.synth_didactic_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.synth_cohort_runs(id) ON DELETE CASCADE,
  package_id uuid NOT NULL,
  persona_key text,
  finding_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warn','critical')),
  detected_by text NOT NULL CHECK (detected_by IN ('heuristic','llm','synth_session')),
  lesson_id uuid,
  competency_id uuid,
  detail text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_fix text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.synth_didactic_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synth_didactic_findings_admin_read" ON public.synth_didactic_findings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_synth_findings_run ON public.synth_didactic_findings (run_id);
CREATE INDEX IF NOT EXISTS idx_synth_findings_severity ON public.synth_didactic_findings (severity);
CREATE INDEX IF NOT EXISTS idx_synth_findings_pkg ON public.synth_didactic_findings (package_id);

CREATE TABLE IF NOT EXISTS public.synth_mastery_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.synth_cohort_runs(id) ON DELETE CASCADE,
  parameter_name text NOT NULL,
  current_value numeric,
  recommended_value numeric,
  confidence numeric,
  rationale text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.synth_mastery_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synth_mastery_calibration_admin_read" ON public.synth_mastery_calibration
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Seed der 7 Personas direkt (kein RPC-Call nötig)
INSERT INTO public.synth_personas
  (persona_key, display_name, description, target_accuracy, response_speed_factor, completion_rate, retry_rate, hint_usage_rate)
VALUES
  ('struggler', 'Struggler', 'Schwacher Lerner: 40% Trefferquote, häufige Hints', 0.40, 1.5, 0.70, 0.40, 0.70),
  ('average', 'Average Learner', 'Durchschnitt: 65% Trefferquote', 0.65, 1.0, 0.92, 0.20, 0.30),
  ('top', 'Top Performer', 'Stark: 85% Trefferquote, schnell', 0.85, 0.8, 0.98, 0.05, 0.10),
  ('speed_runner', 'Speed Runner', 'Schnell aber ungenau: 55% Trefferquote, doppelte Geschwindigkeit', 0.55, 0.4, 0.95, 0.10, 0.15),
  ('quitter', 'Quitter', 'Bricht früh ab: 30% Completion-Rate', 0.50, 1.2, 0.30, 0.15, 0.20),
  ('repeater', 'Repeater', 'Hohe Retry-Rate für Spaced-Repetition-Tests', 0.60, 1.1, 0.95, 0.60, 0.25),
  ('perfectionist', 'Perfectionist', 'Hohe Genauigkeit, langsam, viele Hints', 0.92, 1.8, 1.0, 0.30, 0.50)
ON CONFLICT (persona_key) DO NOTHING;

-- ============================================================
-- RPC: synth_seed_personas (für Re-Seed über UI)
-- ============================================================
CREATE OR REPLACE FUNCTION public.synth_seed_personas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_required'; END IF;
  INSERT INTO public.synth_personas
    (persona_key, display_name, description, target_accuracy, response_speed_factor, completion_rate, retry_rate, hint_usage_rate)
  VALUES
    ('struggler', 'Struggler', 'Schwacher Lerner: 40% Trefferquote', 0.40, 1.5, 0.70, 0.40, 0.70),
    ('average', 'Average Learner', 'Durchschnitt: 65% Trefferquote', 0.65, 1.0, 0.92, 0.20, 0.30),
    ('top', 'Top Performer', 'Stark: 85% Trefferquote', 0.85, 0.8, 0.98, 0.05, 0.10),
    ('speed_runner', 'Speed Runner', 'Schnell aber ungenau', 0.55, 0.4, 0.95, 0.10, 0.15),
    ('quitter', 'Quitter', 'Bricht früh ab', 0.50, 1.2, 0.30, 0.15, 0.20),
    ('repeater', 'Repeater', 'Hohe Retry-Rate', 0.60, 1.1, 0.95, 0.60, 0.25),
    ('perfectionist', 'Perfectionist', 'Hohe Genauigkeit, langsam', 0.92, 1.8, 1.0, 0.30, 0.50)
  ON CONFLICT (persona_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'inserted', v_count,
    'total_personas', (SELECT count(*) FROM public.synth_personas WHERE active = true));
END;
$$;
REVOKE ALL ON FUNCTION public.synth_seed_personas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.synth_seed_personas() TO authenticated;

-- ============================================================
-- RPC: synth_start_run
-- ============================================================
CREATE OR REPLACE FUNCTION public.synth_start_run(
  p_package_ids uuid[] DEFAULT NULL,
  p_persona_keys text[] DEFAULT NULL,
  p_mode text DEFAULT 'heuristic_with_llm_gate'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_pkg_ids uuid[];
  v_persona_keys text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_required'; END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    SELECT array_agg(id) INTO v_pkg_ids FROM public.curriculum_packages WHERE status = 'published';
  ELSE
    v_pkg_ids := p_package_ids;
  END IF;

  IF p_persona_keys IS NULL OR array_length(p_persona_keys, 1) IS NULL THEN
    SELECT array_agg(persona_key) INTO v_persona_keys FROM public.synth_personas WHERE active = true;
  ELSE
    v_persona_keys := p_persona_keys;
  END IF;

  INSERT INTO public.synth_cohort_runs
    (triggered_by, status, mode, package_ids, persona_keys, packages_total)
  VALUES
    (auth.uid(), 'running', p_mode, v_pkg_ids, v_persona_keys, COALESCE(array_length(v_pkg_ids, 1), 0))
  RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.synth_start_run(uuid[], text[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.synth_start_run(uuid[], text[], text) TO authenticated;

-- ============================================================
-- RPC: synth_run_heuristic — bewertet ein Paket regelbasiert
-- ============================================================
CREATE OR REPLACE FUNCTION public.synth_run_heuristic(
  p_run_id uuid, p_package_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_findings_count int := 0;
  v_didactic_score numeric := 100;
  v_ihk_score numeric := 100;
  v_step_score numeric := 100;
  v_q_score numeric := 100;
  v_flagged boolean := false;
  v_total_lessons int;
  v_total_questions int;
  v_competency_count int;
  v_required_steps text[] := ARRAY['einstieg','verstehen','anwenden','wiederholen','mini_check'];
  v_ihk_keywords text[] := ARRAY['prüfung','ihk','abschlussprüfung','handlungsfeld','kompetenz','lernfeld','prüfungsrelevant','ausbildungsordnung'];
  v_course_id uuid;
  rec record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_required'; END IF;

  SELECT course_id INTO v_course_id FROM public.curriculum_packages WHERE id = p_package_id;
  IF v_course_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_course_for_package');
  END IF;

  SELECT count(*) INTO v_total_lessons
  FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id;

  SELECT count(*) INTO v_total_questions
  FROM public.exam_questions WHERE package_id = p_package_id AND status = 'approved';

  SELECT count(DISTINCT competency_id) INTO v_competency_count
  FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id AND competency_id IS NOT NULL;

  -- 1) Fehlende didaktische Schritte
  FOR rec IN
    SELECT l.competency_id, array_agg(DISTINCT l.step_type) AS present_steps
    FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.competency_id IS NOT NULL AND l.step_type IS NOT NULL
    GROUP BY l.competency_id
  LOOP
    IF NOT (v_required_steps <@ rec.present_steps) THEN
      INSERT INTO public.synth_didactic_findings
        (run_id, package_id, finding_type, severity, detected_by, competency_id, detail, evidence, suggested_fix)
      VALUES (
        p_run_id, p_package_id, 'missing_step', 'warn', 'heuristic', rec.competency_id,
        'Kompetenz fehlt mindestens ein didaktischer Schritt',
        jsonb_build_object('present', rec.present_steps, 'required', v_required_steps,
          'missing', (SELECT array_agg(s) FROM unnest(v_required_steps) s WHERE NOT (s = ANY(rec.present_steps)))),
        'Fehlende Schritt-Lessons generieren oder bestehende mappen'
      );
      v_findings_count := v_findings_count + 1;
      v_step_score := v_step_score - 8;
    END IF;
  END LOOP;

  -- 2) IHK-Coverage in Praxis-Steps
  FOR rec IN
    SELECT l.id, l.title, l.content, l.step_type
    FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.step_type IN ('anwenden','wiederholen','mini_check')
  LOOP
    IF (SELECT count(*) FROM unnest(v_ihk_keywords) kw
        WHERE lower(coalesce(rec.content,'') || ' ' || coalesce(rec.title,'')) LIKE '%' || kw || '%') < 2 THEN
      INSERT INTO public.synth_didactic_findings
        (run_id, package_id, finding_type, severity, detected_by, lesson_id, detail, evidence, suggested_fix)
      VALUES (
        p_run_id, p_package_id, 'low_ihk_coverage', 'info', 'heuristic', rec.id,
        format('Lesson "%s" (%s) hat <2 IHK-Begriffe', rec.title, rec.step_type),
        jsonb_build_object('step_type', rec.step_type),
        'IHK-Bezug stärken: Prüfungsformat, Bewertungskriterien, Handlungsfeld referenzieren'
      );
      v_findings_count := v_findings_count + 1;
      v_ihk_score := v_ihk_score - 2;
    END IF;
  END LOOP;

  -- 3) Lessons ohne Lernziele bei Einstieg
  FOR rec IN
    SELECT l.id, l.title FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.step_type = 'einstieg'
      AND (l.learning_objectives IS NULL OR array_length(l.learning_objectives, 1) IS NULL)
  LOOP
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detected_by, lesson_id, detail, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'no_learning_objectives', 'warn', 'heuristic', rec.id,
      format('Einstieg-Lesson "%s" ohne Lernziele', rec.title),
      'learning_objectives als 2-4 Bullet-Items ergänzen'
    );
    v_findings_count := v_findings_count + 1;
    v_didactic_score := v_didactic_score - 3;
  END LOOP;

  -- 4) Sehr kurze Inhalte
  FOR rec IN
    SELECT l.id, l.title, l.step_type, length(coalesce(l.content,'')) AS clen
    FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.step_type IN ('verstehen','anwenden')
      AND length(coalesce(l.content,'')) < 200
  LOOP
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detected_by, lesson_id, detail, evidence, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'short_content', 'warn', 'heuristic', rec.id,
      format('Lesson "%s" (%s) hat nur %s Zeichen', rec.title, rec.step_type, rec.clen),
      jsonb_build_object('content_length', rec.clen, 'step_type', rec.step_type),
      'Inhalt auf mind. 400-800 Zeichen mit Beispiel/Beleg ausbauen'
    );
    v_findings_count := v_findings_count + 1;
    v_didactic_score := v_didactic_score - 2;
  END LOOP;

  -- 5) Duplikat-Titel
  FOR rec IN
    SELECT lower(trim(l.title)) AS norm_title, count(*) AS cnt, array_agg(l.id) AS ids
    FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id GROUP BY lower(trim(l.title)) HAVING count(*) > 1
  LOOP
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detected_by, detail, evidence, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'duplicate_lesson', 'critical', 'heuristic',
      format('Lesson-Titel "%s" %sx vorhanden', rec.norm_title, rec.cnt),
      jsonb_build_object('lesson_ids', rec.ids, 'count', rec.cnt),
      'Duplikate zusammenführen oder Titel differenzieren'
    );
    v_findings_count := v_findings_count + 1;
    v_didactic_score := v_didactic_score - 5;
  END LOOP;

  -- 6) Fragenpool zu klein
  IF v_total_questions < 50 THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detected_by, detail, evidence, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'thin_question_pool', 'warn', 'heuristic',
      format('Nur %s approved Fragen — empfohlen ≥150 für Shuttle-Modus', v_total_questions),
      jsonb_build_object('approved_count', v_total_questions),
      'Fragen-Generation oder Pool-Auffüllung über council/repair'
    );
    v_findings_count := v_findings_count + 1;
    v_q_score := v_q_score - 25;
  END IF;

  v_didactic_score := greatest(0, least(100, v_didactic_score));
  v_step_score := greatest(0, least(100, v_step_score));
  v_ihk_score := greatest(0, least(100, v_ihk_score));
  v_q_score := greatest(0, least(100, v_q_score));

  v_flagged := (v_didactic_score < 70 OR v_step_score < 70 OR v_ihk_score < 60 OR v_q_score < 60
                OR EXISTS (SELECT 1 FROM public.synth_didactic_findings
                           WHERE run_id = p_run_id AND package_id = p_package_id AND severity = 'critical'));

  -- Pro Persona ein Session-Result
  INSERT INTO public.synth_session_results
    (run_id, package_id, persona_key,
     didactic_score, question_quality_score, ihk_coverage_score, step_completeness_score,
     simulated_accuracy, simulated_completion_rate, flagged_for_llm_review, raw_metrics)
  SELECT
    p_run_id, p_package_id, p.persona_key,
    v_didactic_score, v_q_score, v_ihk_score, v_step_score,
    p.target_accuracy * sqrt(v_didactic_score/100.0),
    p.completion_rate * (CASE WHEN v_didactic_score < 50 THEN 0.6 ELSE 1.0 END),
    v_flagged,
    jsonb_build_object('lessons', v_total_lessons, 'questions_approved', v_total_questions,
                       'competencies', v_competency_count, 'findings_added', v_findings_count)
  FROM public.synth_personas p
  WHERE p.persona_key = ANY (
    SELECT unnest(persona_keys) FROM public.synth_cohort_runs WHERE id = p_run_id
  );

  UPDATE public.synth_cohort_runs
  SET packages_completed = packages_completed + 1,
      packages_with_findings = packages_with_findings + (CASE WHEN v_findings_count > 0 THEN 1 ELSE 0 END),
      total_findings = total_findings + v_findings_count
  WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'ok', true, 'package_id', p_package_id,
    'didactic_score', v_didactic_score, 'step_score', v_step_score,
    'ihk_score', v_ihk_score, 'question_score', v_q_score,
    'findings_count', v_findings_count, 'flagged_for_llm_review', v_flagged
  );
END;
$$;
REVOKE ALL ON FUNCTION public.synth_run_heuristic(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.synth_run_heuristic(uuid, uuid) TO authenticated;

-- ============================================================
-- RPC: synth_finalize_run
-- ============================================================
CREATE OR REPLACE FUNCTION public.synth_finalize_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_avg numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT avg(didactic_score) INTO v_avg FROM public.synth_session_results WHERE run_id = p_run_id;
  UPDATE public.synth_cohort_runs
  SET status = 'completed', completed_at = now(), avg_didactic_score = v_avg
  WHERE id = p_run_id;
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'avg_didactic_score', v_avg);
END;
$$;
REVOKE ALL ON FUNCTION public.synth_finalize_run(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.synth_finalize_run(uuid) TO authenticated;

-- ============================================================
-- RPC: synth_get_run_summary
-- ============================================================
CREATE OR REPLACE FUNCTION public.synth_get_run_summary(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_run jsonb; v_packages jsonb; v_top_findings jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT to_jsonb(r) INTO v_run FROM public.synth_cohort_runs r WHERE r.id = p_run_id;

  SELECT jsonb_agg(p ORDER BY (p->>'avg_didactic_score')::numeric ASC NULLS LAST) INTO v_packages
  FROM (
    SELECT
      sr.package_id, cp.label AS package_label,
      avg(sr.didactic_score)::numeric(5,2) AS avg_didactic_score,
      avg(sr.ihk_coverage_score)::numeric(5,2) AS avg_ihk_score,
      avg(sr.question_quality_score)::numeric(5,2) AS avg_question_score,
      bool_or(sr.flagged_for_llm_review) AS flagged,
      (SELECT count(*) FROM public.synth_didactic_findings f
        WHERE f.run_id = p_run_id AND f.package_id = sr.package_id) AS findings_count,
      (SELECT count(*) FROM public.synth_didactic_findings f
        WHERE f.run_id = p_run_id AND f.package_id = sr.package_id AND f.severity = 'critical') AS critical_count
    FROM public.synth_session_results sr
    LEFT JOIN public.curriculum_packages cp ON cp.id = sr.package_id
    WHERE sr.run_id = p_run_id GROUP BY sr.package_id, cp.label
  ) p;

  SELECT jsonb_agg(to_jsonb(f)) INTO v_top_findings
  FROM (
    SELECT f.id, f.package_id, cp.label AS package_label,
           f.finding_type, f.severity, f.detail, f.suggested_fix
    FROM public.synth_didactic_findings f
    LEFT JOIN public.curriculum_packages cp ON cp.id = f.package_id
    WHERE f.run_id = p_run_id
    ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, f.created_at DESC
    LIMIT 50
  ) f;

  RETURN jsonb_build_object(
    'run', v_run,
    'packages', COALESCE(v_packages, '[]'::jsonb),
    'top_findings', COALESCE(v_top_findings, '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.synth_get_run_summary(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.synth_get_run_summary(uuid) TO authenticated;

-- ============================================================
-- RPC: synth_list_runs
-- ============================================================
CREATE OR REPLACE FUNCTION public.synth_list_runs(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC), '[]'::jsonb)
  FROM (
    SELECT id, status, mode, packages_total, packages_completed,
           packages_with_findings, total_findings, llm_calls,
           avg_didactic_score, started_at, completed_at
    FROM public.synth_cohort_runs
    WHERE public.has_role(auth.uid(), 'admin')
    ORDER BY started_at DESC LIMIT p_limit
  ) r;
$$;
REVOKE ALL ON FUNCTION public.synth_list_runs(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.synth_list_runs(int) TO authenticated;