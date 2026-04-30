
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

  -- 1) Fehlende didaktische Schritte pro Kompetenz
  FOR rec IN
    SELECT l.competency_id, array_agg(DISTINCT l.step::text) AS present_steps
    FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.competency_id IS NOT NULL
    GROUP BY l.competency_id
  LOOP
    IF NOT (rec.present_steps @> v_required_steps) THEN
      INSERT INTO public.synth_didactic_findings
        (run_id, package_id, competency_id, finding_type, severity, detail, evidence, detected_by, suggested_fix)
      VALUES (
        p_run_id, p_package_id, rec.competency_id, 'missing_step', 'warn',
        'Kompetenz hat unvollständige Step-Sequenz',
        jsonb_build_object('present', rec.present_steps, 'required', v_required_steps),
        'heuristic',
        'Fehlende Step-Typen ergänzen (einstieg/verstehen/anwenden/wiederholen/mini_check).'
      );
      v_findings_count := v_findings_count + 1;
      v_step_score := GREATEST(0, v_step_score - 8);
    END IF;
  END LOOP;

  -- 2) IHK-Coverage
  IF EXISTS (
    SELECT 1 FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id
      AND l.step::text IN ('anwenden','wiederholen','mini_check')
      AND (
        SELECT count(*) FROM unnest(v_ihk_keywords) k
        WHERE coalesce(l.content::text,'') ILIKE '%' || k || '%'
      ) < 2
    LIMIT 1
  ) THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, evidence, detected_by, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'low_ihk_coverage', 'warn',
      'IHK-Bezug in Praxis-Steps zu schwach',
      jsonb_build_object('min_keywords', 2),
      'heuristic',
      'IHK-Bezug in Anwenden/Wiederholen/Mini-Check stärken (min. 2 prüfungsrelevante Begriffe).'
    );
    v_findings_count := v_findings_count + 1;
    v_ihk_score := GREATEST(0, v_ihk_score - 15);
  END IF;

  -- 4) Kurzer Content
  IF EXISTS (
    SELECT 1 FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id AND l.step::text IN ('verstehen','anwenden')
      AND length(coalesce(l.content::text,'')) < 200
  ) THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, evidence, detected_by, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'short_content', 'info',
      'Lessons mit zu kurzem Inhalt entdeckt',
      jsonb_build_object('min_chars', 200),
      'heuristic',
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
      (run_id, package_id, finding_type, severity, detail, evidence, detected_by, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'duplicate_lesson', 'info',
      'Doppelte Lesson-Titel entdeckt',
      '{}'::jsonb,
      'heuristic',
      'Doppelte Lesson-Titel identifizieren und konsolidieren.'
    );
    v_findings_count := v_findings_count + 1;
  END IF;

  -- 6) Fragen-Pool
  IF v_total_questions < 50 THEN
    INSERT INTO public.synth_didactic_findings
      (run_id, package_id, finding_type, severity, detail, evidence, detected_by, suggested_fix)
    VALUES (
      p_run_id, p_package_id, 'thin_question_pool', 'critical',
      'Fragen-Pool unter Mindestschwelle',
      jsonb_build_object('approved', v_total_questions, 'min_required', 50),
      'heuristic',
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

  -- Synth-Sessions pro aktiver Persona im Run (echtes Schema)
  INSERT INTO public.synth_session_results
    (run_id, package_id, persona_key,
     simulated_accuracy, simulated_completion_rate,
     didactic_score, step_completeness_score, ihk_coverage_score, question_quality_score,
     flagged_for_llm_review, raw_metrics)
  SELECT
    p_run_id, p_package_id, p.persona_key,
    p.target_accuracy, p.completion_rate,
    v_didactic_score, v_step_score, v_ihk_score, v_q_score,
    v_flagged,
    jsonb_build_object(
      'simulated_questions', LEAST(v_total_questions, 30),
      'correct_count', GREATEST(0, round(LEAST(v_total_questions, 30) * p.target_accuracy))::int,
      'avg_response_ms', round(8000 * p.response_speed_factor)::int,
      'total_lessons', v_total_lessons,
      'total_approved_questions', v_total_questions
    )
  FROM public.synth_personas p
  WHERE p.active = true
    AND p.persona_key = ANY((SELECT persona_keys FROM public.synth_cohort_runs WHERE id = p_run_id));

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

-- Auch synth_get_run_summary an echtes Schema anpassen (cp.title statt cp.label, und Findings-Felder)
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
      sr.package_id, cp.title AS package_label,
      avg(sr.didactic_score)::numeric(5,2) AS avg_didactic_score,
      avg(sr.ihk_coverage_score)::numeric(5,2) AS avg_ihk_score,
      avg(sr.question_quality_score)::numeric(5,2) AS avg_question_score,
      bool_or(sr.flagged_for_llm_review) AS flagged,
      (SELECT count(*) FROM public.synth_didactic_findings f
        WHERE f.run_id = p_run_id AND f.package_id = sr.package_id) AS findings_count,
      (SELECT count(*) FROM public.synth_didactic_findings f
        WHERE f.run_id = p_run_id AND f.package_id = sr.package_id AND f.severity = 'critical') AS critical_count
    FROM public.synth_session_results sr
    LEFT JOIN public.course_packages cp ON cp.id = sr.package_id
    WHERE sr.run_id = p_run_id GROUP BY sr.package_id, cp.title
  ) p;

  SELECT jsonb_agg(to_jsonb(f)) INTO v_top_findings
  FROM (
    SELECT f.id, f.package_id, cp.title AS package_label,
           f.finding_type, f.severity, f.detail, f.evidence, f.suggested_fix
    FROM public.synth_didactic_findings f
    LEFT JOIN public.course_packages cp ON cp.id = f.package_id
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
