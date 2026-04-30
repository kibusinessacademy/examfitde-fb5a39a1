
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

  SELECT course_id INTO v_course_id FROM public.course_packages WHERE id = p_package_id;
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

  -- 1) Fehlende didaktische Schritte pro Kompetenz
  FOR rec IN
    SELECT l.competency_id, array_agg(DISTINCT l.step) AS present_steps
    FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.competency_id IS NOT NULL
    GROUP BY l.competency_id
  LOOP
    IF NOT (rec.present_steps @> v_required_steps) THEN
      INSERT INTO public.synth_didactic_findings
        (run_id, package_id, finding_type, severity, detail, suggested_fix)
      VALUES (
        p_run_id, p_package_id, 'missing_step', 'warn',
        jsonb_build_object('competency_id', rec.competency_id, 'present', rec.present_steps, 'required', v_required_steps),
        'Fehlende Step-Typen für Kompetenz ergänzen (einstieg/verstehen/anwenden/wiederholen/mini_check).'
      );
      v_findings_count := v_findings_count + 1;
      v_step_score := GREATEST(0, v_step_score - 8);
    END IF;
  END LOOP;

  -- 2) IHK-Coverage
  IF EXISTS (
    SELECT 1 FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id
      AND l.step IN ('anwenden','wiederholen','mini_check')
      AND (
        SELECT count(*) FROM unnest(v_ihk_keywords) k
        WHERE l.content ILIKE '%' || k || '%'
      ) < 2
    LIMIT 1
  ) THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'low_ihk_coverage', 'warn',
      jsonb_build_object('min_keywords', 2),
      'IHK-Bezug in Anwenden/Wiederholen/Mini-Check stärken (min. 2 prüfungsrelevante Begriffe pro Lesson).'
    );
    v_findings_count := v_findings_count + 1;
    v_ihk_score := GREATEST(0, v_ihk_score - 15);
  END IF;

  -- 3) learning_objectives — Spalte existiert ggf. nicht; skip safely
  -- (entfernt, da Spalte in lessons nicht garantiert ist)

  -- 4) Kurzer Content
  IF EXISTS (
    SELECT 1 FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.step IN ('verstehen','anwenden')
      AND length(coalesce(l.content,'')) < 200
  ) THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'short_content', 'info',
      jsonb_build_object('min_chars', 200),
      'Inhalt auf Verstehen/Anwenden ausbauen (≥200 Zeichen).'
    );
    v_findings_count := v_findings_count + 1;
    v_didactic_score := GREATEST(0, v_didactic_score - 3);
  END IF;

  -- 5) Duplikate
  IF EXISTS (
    SELECT 1 FROM (
      SELECT l.title, count(*) c
      FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
      WHERE m.course_id = v_course_id GROUP BY l.title HAVING count(*) > 1
    ) d
  ) THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'duplicate_lesson', 'info', '{}'::jsonb,
      'Doppelte Lesson-Titel identifizieren und konsolidieren.'
    );
    v_findings_count := v_findings_count + 1;
  END IF;

  -- 6) Fragen-Pool
  IF v_total_questions < 50 THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'thin_question_pool', 'critical',
      jsonb_build_object('approved', v_total_questions, 'min_required', 50),
      'Fragen-Pool ausbauen (Ziel ≥150 approved).'
    );
    v_findings_count := v_findings_count + 1;
    v_q_score := GREATEST(0, v_q_score - 40);
  ELSIF v_total_questions < 150 THEN
    v_q_score := GREATEST(0, v_q_score - 15);
  END IF;

  v_didactic_score := (v_didactic_score + v_step_score + v_ihk_score + v_q_score) / 4.0;

  IF v_didactic_score < 70 OR v_step_score < 70 OR v_ihk_score < 60 OR v_q_score < 60 THEN
    v_flagged := true;
  END IF;

  -- Synth-Sessions pro aktiver Persona im Run
  INSERT INTO public.synth_session_results
    (run_id, package_id, persona_id, persona_key,
     simulated_questions, correct_count, accuracy, avg_response_ms,
     completion_rate, didactic_score, ihk_coverage_score, question_quality_score,
     flagged_for_llm_review)
  SELECT
    p_run_id, p_package_id, p.id, p.persona_key,
    LEAST(v_total_questions, 30) AS simulated_questions,
    GREATEST(0, round(LEAST(v_total_questions, 30) * p.target_accuracy))::int AS correct_count,
    p.target_accuracy AS accuracy,
    round(8000 * p.response_speed_factor)::int AS avg_response_ms,
    p.completion_rate,
    v_didactic_score, v_ihk_score, v_q_score, v_flagged
  FROM public.synth_personas p
  WHERE p.active = true
    AND p.persona_key = ANY((SELECT persona_keys FROM public.synth_cohort_runs WHERE id = p_run_id));

  -- Aggregate auf Run-Header
  UPDATE public.synth_cohort_runs
  SET packages_completed = packages_completed + 1,
      total_findings = total_findings + v_findings_count,
      packages_with_findings = packages_with_findings + (CASE WHEN v_findings_count > 0 THEN 1 ELSE 0 END)
  WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'didactic_score', v_didactic_score,
    'step_score', v_step_score,
    'ihk_score', v_ihk_score,
    'question_score', v_q_score,
    'findings_count', v_findings_count,
    'flagged', v_flagged,
    'total_questions', v_total_questions,
    'total_lessons', v_total_lessons
  );
END;
$$;
