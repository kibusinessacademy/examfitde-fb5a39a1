
CREATE OR REPLACE FUNCTION public.get_vertical_occupational_dna(_vertical_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result JSONB;
BEGIN
  IF _vertical_slug IS NULL OR length(trim(_vertical_slug)) = 0 THEN
    RETURN jsonb_build_object('error', 'vertical_slug_required');
  END IF;

  WITH dna AS (
    SELECT id, vertical_slug, industry_key, name, description,
           roles, kpis, risks, pain_points, sops, regulatory_context
    FROM public.vertical_dna
    WHERE vertical_slug = _vertical_slug
      AND is_active = true
    LIMIT 1
  ),
  certs AS (
    SELECT cc.id, cc.slug, cc.title, cc.catalog_type, cc.chamber_type,
           cc.recognition_type, cc.track, cc.linked_certification_id AS certification_id
    FROM public.certification_catalog cc
    WHERE _vertical_slug = ANY(cc.vertical_slugs)
    ORDER BY cc.priority_score DESC, cc.title ASC
  ),
  curr AS (
    SELECT DISTINCT c.id, c.title, c.status::text AS status, c.track::text AS track,
           c.certification_type::text AS certification_type
    FROM public.curricula c
    WHERE c.certification_id IN (SELECT certification_id FROM certs WHERE certification_id IS NOT NULL)
  ),
  lf_agg AS (
    SELECT lf.curriculum_id,
           COUNT(*) AS field_count,
           jsonb_agg(jsonb_build_object('code', lf.code, 'title', lf.title, 'weight_percent', lf.weight_percent)
                     ORDER BY lf.sort_order, lf.code) AS fields
    FROM public.learning_fields lf
    WHERE lf.curriculum_id IN (SELECT id FROM curr)
    GROUP BY lf.curriculum_id
  ),
  comp_agg AS (
    SELECT lf.curriculum_id,
           COUNT(*) AS competency_count
    FROM public.competencies cp
    JOIN public.learning_fields lf ON lf.id = cp.learning_field_id
    WHERE lf.curriculum_id IN (SELECT id FROM curr)
    GROUP BY lf.curriculum_id
  ),
  summary AS (
    SELECT certifications_count, curricula_count, learning_fields_count, competencies_count, blueprints_count
    FROM public.v_vertical_occupational_intelligence
    WHERE vertical_slug = _vertical_slug
  )
  SELECT jsonb_build_object(
    'vertical', (SELECT to_jsonb(d) FROM dna d),
    'summary',  COALESCE((SELECT to_jsonb(s) FROM summary s), '{}'::jsonb),
    'certifications', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.title) FROM certs c), '[]'::jsonb),
    'curricula', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', cu.id,
          'title', cu.title,
          'status', cu.status,
          'track', cu.track,
          'certification_type', cu.certification_type,
          'learning_field_count', COALESCE(lfa.field_count, 0),
          'competency_count', COALESCE(ca.competency_count, 0),
          'learning_fields', COALESCE(lfa.fields, '[]'::jsonb)
        )
        ORDER BY cu.title
      )
      FROM curr cu
      LEFT JOIN lf_agg lfa ON lfa.curriculum_id = cu.id
      LEFT JOIN comp_agg ca ON ca.curriculum_id = cu.id
    ), '[]'::jsonb)
  ) INTO _result;

  IF _result->'vertical' IS NULL OR _result->'vertical' = 'null'::jsonb THEN
    RETURN jsonb_build_object('error', 'vertical_not_found', 'vertical_slug', _vertical_slug);
  END IF;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vertical_occupational_dna(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vertical_occupational_dna(TEXT) TO anon, authenticated, service_role;
