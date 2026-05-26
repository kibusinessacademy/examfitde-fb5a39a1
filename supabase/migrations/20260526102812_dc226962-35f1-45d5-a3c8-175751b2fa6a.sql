-- Cut 6.1 Migration A (retry): Unified Competency Graph SSOT

CREATE OR REPLACE VIEW public.v_unified_competency_graph AS
SELECT
  cp.id                                 AS package_id,
  cp.package_key                        AS package_key,
  cp.title                              AS package_title,
  cp.status                             AS package_status,
  cp.is_published                       AS package_is_published,
  cp.track                              AS package_track,
  cp.curriculum_id                      AS curriculum_id,
  cur.title                             AS curriculum_title,
  lf.id                                 AS learning_field_id,
  lf.code                               AS learning_field_code,
  lf.title                              AS learning_field_title,
  lf.sort_order                         AS learning_field_sort,
  c.id                                  AS competency_id,
  c.code                                AS competency_code,
  c.title                               AS competency_title,
  c.description                         AS competency_description,
  c.bloom_level                         AS competency_bloom,
  c.exam_relevance_tier                 AS competency_exam_tier,
  COALESCE(qb_cnt.cnt, 0)               AS question_blueprint_count,
  COALESCE(ob_cnt.cnt, 0)               AS oral_blueprint_count,
  COALESCE(les_cnt.cnt, 0)              AS lesson_count,
  COALESCE(eq_cnt.cnt, 0)               AS approved_question_count,
  COALESCE(oq_cnt.cnt, 0)               AS oral_question_count
FROM public.course_packages cp
LEFT JOIN public.curricula cur          ON cur.id = cp.curriculum_id
LEFT JOIN public.learning_fields lf     ON lf.curriculum_id = cp.curriculum_id
LEFT JOIN public.competencies c         ON c.learning_field_id = lf.id
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.question_blueprints qb WHERE qb.competency_id = c.id AND qb.status IS NOT NULL) qb_cnt ON true
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.oral_exam_blueprints ob WHERE ob.competency_id = c.id) ob_cnt ON true
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.lessons l WHERE l.competency_id = c.id) les_cnt ON true
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.exam_questions eq WHERE eq.competency_id = c.id AND eq.package_id = cp.id AND eq.status = 'approved') eq_cnt ON true
LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM public.oral_exam_questions oq WHERE oq.competency_id = c.id) oq_cnt ON true;

COMMENT ON VIEW public.v_unified_competency_graph IS
  'Cut 6.1 SSOT: read-only projection Beruf->Lernfeld->Kompetenz with artifact counts. Bridges 7 existing tables.';

REVOKE ALL ON public.v_unified_competency_graph FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_unified_competency_graph TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_competency_graph_for_package(_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'package_id', _package_id,
    'package_title', MAX(package_title),
    'package_key', MAX(package_key),
    'is_published', BOOL_OR(package_is_published),
    'learning_fields', jsonb_agg(DISTINCT jsonb_build_object(
      'id', learning_field_id, 'code', learning_field_code, 'title', learning_field_title
    )) FILTER (WHERE learning_field_id IS NOT NULL),
    'competency_summary', jsonb_build_object(
      'total_competencies', COUNT(DISTINCT competency_id),
      'total_approved_questions', SUM(approved_question_count),
      'total_lessons', SUM(lesson_count),
      'total_oral_blueprints', SUM(oral_blueprint_count)
    )
  ) INTO v_result
  FROM public.v_unified_competency_graph
  WHERE package_id = _package_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'not_found'));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_competency_graph_for_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_competency_graph_for_package(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_get_demo_competency_summary(_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_is_published boolean;
BEGIN
  SELECT is_published INTO v_is_published FROM public.course_packages WHERE id = _package_id;

  IF NOT COALESCE(v_is_published, false) THEN
    RETURN jsonb_build_object('error', 'not_available', 'reason', 'package_not_published');
  END IF;

  SELECT jsonb_build_object(
    'package_id', _package_id,
    'package_title', MAX(package_title),
    'package_key', MAX(package_key),
    'curriculum_title', MAX(curriculum_title),
    'learning_fields', (
      SELECT jsonb_agg(jsonb_build_object(
        'title', lf_title,
        'competencies', comp_array,
        'lesson_count', lesson_total,
        'question_count', question_total,
        'oral_scenario_count', oral_total
      ) ORDER BY lf_sort)
      FROM (
        SELECT
          learning_field_title           AS lf_title,
          MIN(learning_field_sort)       AS lf_sort,
          jsonb_agg(DISTINCT competency_title) FILTER (WHERE competency_title IS NOT NULL) AS comp_array,
          SUM(lesson_count)              AS lesson_total,
          SUM(approved_question_count)   AS question_total,
          SUM(oral_question_count)       AS oral_total
        FROM public.v_unified_competency_graph
        WHERE package_id = _package_id
        GROUP BY learning_field_title
      ) lf_agg
    ),
    'totals', jsonb_build_object(
      'competencies', COUNT(DISTINCT competency_id),
      'lessons', SUM(lesson_count),
      'questions', SUM(approved_question_count),
      'oral_scenarios', SUM(oral_question_count)
    )
  ) INTO v_result
  FROM public.v_unified_competency_graph
  WHERE package_id = _package_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'not_found'));
END;
$$;

REVOKE ALL ON FUNCTION public.public_get_demo_competency_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_demo_competency_summary(uuid) TO anon, authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module, schema_version)
VALUES (
  'competency_graph_demo_view',
  ARRAY['package_id', 'requester_persona']::text[],
  'cut_6_1_demo',
  1
)
ON CONFLICT (action_type) DO UPDATE SET
  required_keys = EXCLUDED.required_keys,
  owner_module = EXCLUDED.owner_module,
  updated_at = now();

DO $$
DECLARE v_published_count int;
BEGIN
  SELECT COUNT(DISTINCT package_id) INTO v_published_count
  FROM public.v_unified_competency_graph
  WHERE package_is_published = true;
  RAISE NOTICE 'Cut 6.1 L1 smoke: % published packages in graph view', v_published_count;
END $$;