CREATE OR REPLACE FUNCTION public.start_exam_session(p_blueprint_id uuid, p_mode text DEFAULT 'simulation'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_blueprint record;
  v_session_id uuid;
  v_seed int;
  v_readiness jsonb;
  v_qid uuid;
  v_mastery_qids uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_blueprint
  FROM public.exam_blueprints
  WHERE id = p_blueprint_id AND frozen = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blueprint not found or not frozen';
  END IF;

  IF p_mode IN ('simulation', 'timed_exam') THEN
    BEGIN
      v_readiness := public.get_exam_readiness(v_user_id, v_blueprint.curriculum_id);
      IF v_readiness IS NOT NULL AND NOT coalesce((v_readiness->>'allowed')::boolean, true) THEN
        RAISE EXCEPTION 'READINESS_BLOCKED: %', coalesce(v_readiness->>'blocked_reason', 'Readiness check failed');
      END IF;
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  v_seed := floor(extract(epoch from now()))::int;

  INSERT INTO public.exam_sessions (
    user_id, curriculum_id, blueprint_id, mode, seed,
    total_questions, time_limit_minutes
  ) VALUES (
    v_user_id, v_blueprint.curriculum_id, p_blueprint_id, p_mode, v_seed,
    v_blueprint.total_questions,
    CASE WHEN p_mode = 'timed_exam' THEN v_blueprint.time_limit_minutes ELSE NULL END
  ) RETURNING id INTO v_session_id;

  IF p_mode = 'adaptive' THEN
    v_qid := public.pick_next_adaptive_question(v_session_id);

    IF v_qid IS NULL THEN
      RAISE EXCEPTION 'No suitable adaptive question found for this curriculum';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.exam_session_questions
      WHERE exam_session_id = v_session_id AND question_id = v_qid
    ) THEN
      INSERT INTO public.exam_session_questions (
        exam_session_id, question_id, order_index, difficulty
      )
      SELECT v_session_id, eq.id, 0,
        CASE
          WHEN eq.item_difficulty < -1 THEN 'easy'
          WHEN eq.item_difficulty < 0.5 THEN 'medium'
          WHEN eq.item_difficulty < 1.5 THEN 'hard'
          ELSE 'very_hard'
        END
      FROM public.exam_questions eq
      WHERE eq.id = v_qid;
    END IF;

    RETURN v_session_id;
  END IF;

  v_mastery_qids := public.assemble_mastery_weighted_exam(
    v_user_id,
    v_blueprint.curriculum_id,
    v_blueprint.total_questions,
    2
  );

  IF v_mastery_qids IS NOT NULL AND array_length(v_mastery_qids, 1) > 0 THEN
    INSERT INTO public.exam_session_questions (
      exam_session_id, question_id, order_index, difficulty,
      learning_field_code, competency_code
    )
    SELECT
      v_session_id, eq.id,
      row_number() OVER (ORDER BY random()),
      eq.difficulty, lf.code, comp.code
    FROM public.exam_questions eq
    LEFT JOIN public.learning_fields lf ON lf.id = eq.learning_field_id
    LEFT JOIN public.competencies comp ON comp.id = eq.competency_id
    WHERE eq.id = ANY(v_mastery_qids)
    ORDER BY random();
  ELSE
    INSERT INTO public.exam_session_questions (
      exam_session_id, question_id, order_index, difficulty,
      learning_field_code, competency_code
    )
    SELECT
      v_session_id, eq.id,
      row_number() OVER (ORDER BY random()),
      eq.difficulty, lf.code, comp.code
    FROM public.exam_questions eq
    LEFT JOIN public.learning_fields lf ON lf.id = eq.learning_field_id
    LEFT JOIN public.competencies comp ON comp.id = eq.competency_id
    WHERE eq.curriculum_id = v_blueprint.curriculum_id
      AND eq.status = 'approved'
    ORDER BY random()
    LIMIT v_blueprint.total_questions;
  END IF;

  RETURN v_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.public_course_package_counts(
  p_curriculum_id uuid,
  p_course_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'oral_blueprints', (
      SELECT count(*)::int FROM public.oral_exam_blueprints
      WHERE curriculum_id = p_curriculum_id
    ),
    'minicheck_sets', (
      SELECT count(*)::int FROM public.minicheck_sets
      WHERE course_id = p_course_id
    ),
    'handbook_chapters', (
      SELECT count(*)::int FROM public.handbook_chapters
      WHERE curriculum_id = p_curriculum_id AND is_published = true
    ),
    'exam_questions', (
      SELECT count(*)::int FROM public.exam_questions
      WHERE curriculum_id = p_curriculum_id AND status = 'approved'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.public_course_package_counts(uuid, uuid) TO anon, authenticated;
