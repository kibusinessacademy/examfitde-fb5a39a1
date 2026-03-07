
-- 1) Upgrade finish_exam_session to include by_skill_node and by_competency breakdown
CREATE OR REPLACE FUNCTION public.finish_exam_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session record;
  v_total int;
  v_correct int;
  v_score numeric;
  v_passed boolean;
  v_by_difficulty jsonb := '{}'::jsonb;
  v_by_lf jsonb := '{}'::jsonb;
  v_by_competency jsonb := '{}'::jsonb;
  v_by_skill_node jsonb := '{}'::jsonb;
  v_pass_threshold numeric;
  rec record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_session FROM public.exam_sessions
  WHERE id = p_session_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.finished_at IS NOT NULL THEN RAISE EXCEPTION 'Session already finished'; END IF;

  SELECT count(*), count(*) FILTER (WHERE is_correct = true)
  INTO v_total, v_correct
  FROM public.exam_session_questions WHERE exam_session_id = p_session_id;

  v_score := CASE WHEN v_total > 0 THEN (v_correct::numeric / v_total * 100) ELSE 0 END;

  SELECT coalesce(pass_threshold, 50) INTO v_pass_threshold
  FROM public.exam_blueprints WHERE id = v_session.blueprint_id;

  v_passed := v_score >= v_pass_threshold;

  -- by_difficulty
  FOR rec IN
    SELECT difficulty, count(*) as total, count(*) FILTER (WHERE is_correct = true) as correct
    FROM public.exam_session_questions WHERE exam_session_id = p_session_id GROUP BY difficulty
  LOOP
    v_by_difficulty := v_by_difficulty || jsonb_build_object(rec.difficulty, jsonb_build_object('total', rec.total, 'correct', rec.correct));
  END LOOP;

  -- by_learning_field
  FOR rec IN
    SELECT coalesce(learning_field_code, 'unknown') as lf, count(*) as total, count(*) FILTER (WHERE is_correct = true) as correct
    FROM public.exam_session_questions WHERE exam_session_id = p_session_id GROUP BY learning_field_code
  LOOP
    v_by_lf := v_by_lf || jsonb_build_object(rec.lf, jsonb_build_object('total', rec.total, 'correct', rec.correct));
  END LOOP;

  -- by_competency (via competency_code -> competencies)
  FOR rec IN
    SELECT
      c.id::text as comp_id,
      c.title as comp_title,
      coalesce(esq.competency_code, 'unknown') as comp_code,
      count(*) as total,
      count(*) FILTER (WHERE esq.is_correct = true) as correct
    FROM public.exam_session_questions esq
    LEFT JOIN public.competencies c ON c.code = esq.competency_code
    LEFT JOIN public.learning_fields lf ON lf.id = c.learning_field_id AND lf.curriculum_id = v_session.curriculum_id
    WHERE esq.exam_session_id = p_session_id
    GROUP BY c.id, c.title, esq.competency_code
  LOOP
    v_by_competency := v_by_competency || jsonb_build_object(
      coalesce(rec.comp_code, 'unknown'),
      jsonb_build_object('total', rec.total, 'correct', rec.correct, 'title', coalesce(rec.comp_title, rec.comp_code), 'accuracy_pct', CASE WHEN rec.total > 0 THEN round(rec.correct::numeric / rec.total * 100, 1) ELSE 0 END)
    );
  END LOOP;

  -- by_skill_node (via competency_code -> skill_nodes)
  FOR rec IN
    SELECT
      sn.id::text as skill_id,
      sn.kompetenz,
      sn.lernfeld,
      count(*) as total,
      count(*) FILTER (WHERE esq.is_correct = true) as correct
    FROM public.exam_session_questions esq
    JOIN public.skill_nodes sn ON sn.kompetenz = esq.competency_code AND sn.curriculum_id = v_session.curriculum_id
    WHERE esq.exam_session_id = p_session_id
    GROUP BY sn.id, sn.kompetenz, sn.lernfeld
  LOOP
    v_by_skill_node := v_by_skill_node || jsonb_build_object(
      rec.skill_id,
      jsonb_build_object('total', rec.total, 'correct', rec.correct, 'kompetenz', rec.kompetenz, 'lernfeld', rec.lernfeld, 'accuracy_pct', CASE WHEN rec.total > 0 THEN round(rec.correct::numeric / rec.total * 100, 1) ELSE 0 END)
    );
  END LOOP;

  UPDATE public.exam_sessions
  SET finished_at = now(), score_percentage = v_score, passed = v_passed,
      breakdown = jsonb_build_object(
        'by_difficulty', v_by_difficulty,
        'by_learning_field', v_by_lf,
        'by_competency', v_by_competency,
        'by_skill_node', v_by_skill_node
      )
  WHERE id = p_session_id;

  -- WEAKNESS LOOP: remediation items for competencies < 70%
  INSERT INTO public.user_remediation_queue (user_id, curriculum_id, competency_id, source_session_id, score_at_detection, status)
  SELECT
    v_user_id, v_session.curriculum_id, c.id, p_session_id,
    round((count(*) FILTER (WHERE esq.is_correct = true)::numeric / nullif(count(*), 0) * 100)),
    'pending'
  FROM public.exam_session_questions esq
  JOIN public.exam_questions eq ON eq.id = esq.question_id
  JOIN public.competencies c ON c.code = esq.competency_code
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id AND lf.curriculum_id = v_session.curriculum_id
  WHERE esq.exam_session_id = p_session_id
  GROUP BY c.id
  HAVING (count(*) FILTER (WHERE esq.is_correct = true)::numeric / nullif(count(*), 0) * 100) < 70
  ON CONFLICT (user_id, curriculum_id, competency_id, status) DO NOTHING;

  -- Mark related lesson_outcomes as needs_review
  UPDATE public.lesson_outcomes lo SET needs_review = true
  FROM public.user_remediation_queue urq
  WHERE urq.user_id = v_user_id
    AND urq.source_session_id = p_session_id
    AND urq.status = 'pending'
    AND lo.user_id = v_user_id
    AND lo.competency_id = urq.competency_id;

  RETURN jsonb_build_object(
    'total_questions', v_total, 'correct_answers', v_correct,
    'score_percentage', v_score, 'passed', v_passed,
    'pass_threshold', v_pass_threshold,
    'breakdown', jsonb_build_object(
      'by_difficulty', v_by_difficulty,
      'by_learning_field', v_by_lf,
      'by_competency', v_by_competency,
      'by_skill_node', v_by_skill_node
    )
  );
END;
$$;
