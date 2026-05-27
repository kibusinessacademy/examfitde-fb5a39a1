CREATE OR REPLACE FUNCTION public.get_vertical_occupational_dna(_vertical_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  result JSONB;
BEGIN
  IF _vertical_slug IS NULL OR length(trim(_vertical_slug)) = 0 THEN
    RETURN jsonb_build_object('error', 'vertical_slug_required');
  END IF;

  SELECT * INTO v FROM public.vertical_dna WHERE vertical_slug = _vertical_slug LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vertical_not_found', 'vertical_slug', _vertical_slug);
  END IF;

  result := jsonb_build_object(
    'vertical', jsonb_build_object(
      'id', v.id,
      'vertical_slug', v.vertical_slug,
      'industry_key', v.industry_key,
      'name', v.name,
      'description', v.description,
      'roles', COALESCE(to_jsonb(v.roles), '[]'::jsonb),
      'kpis', COALESCE(v.kpis, '[]'::jsonb),
      'risks', COALESCE(v.risks, '[]'::jsonb),
      'pain_points', COALESCE(v.pain_points, '[]'::jsonb),
      'sops', COALESCE(v.sops, '[]'::jsonb),
      'regulatory_context', COALESCE(v.regulatory_context, '{}'::jsonb),
      'processes', COALESCE(v.processes, '[]'::jsonb),
      'documents', COALESCE(v.documents, '[]'::jsonb),
      'workflow_types', COALESCE(v.workflow_types, '[]'::jsonb),
      'escalations', COALESCE(v.escalations, '[]'::jsonb),
      'outcomes', COALESCE(v.outcomes, '[]'::jsonb),
      'persona_seeds', COALESCE(v.persona_seeds, '[]'::jsonb),
      'kpi_models', COALESCE(v.kpi_models, '[]'::jsonb),
      'communication_models', COALESCE(v.communication_models, '[]'::jsonb),
      'decision_models', COALESCE(v.decision_models, '[]'::jsonb),
      'document_intelligence', COALESCE(v.document_intelligence, '[]'::jsonb)
    ),
    'summary', COALESCE((
      SELECT to_jsonb(s) - 'vertical_slug' - 'vertical_name' - 'industry_key'
      FROM public.v_vertical_occupational_intelligence s
      WHERE s.vertical_slug = v.vertical_slug
    ), '{}'::jsonb),
    'certifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cc.id,
        'slug', cc.slug,
        'title', cc.title,
        'catalog_type', cc.catalog_type,
        'chamber_type', cc.chamber_type,
        'recognition_type', cc.recognition_type,
        'track', cc.track,
        'certification_id', cc.linked_certification_id
      ) ORDER BY cc.title)
      FROM public.certification_catalog cc
      WHERE v.vertical_slug = ANY(cc.vertical_slugs)
    ), '[]'::jsonb),
    'curricula', COALESCE((
      SELECT jsonb_agg(curr ORDER BY curr->>'title')
      FROM (
        SELECT jsonb_build_object(
          'id', cu.id,
          'title', cu.title,
          'status', cu.status,
          'track', cu.track,
          'certification_type', cu.certification_type,
          'learning_field_count', (
            SELECT count(*) FROM public.learning_fields lf WHERE lf.curriculum_id = cu.id
          ),
          'competency_count', (
            SELECT count(*) FROM public.competencies cmp
            JOIN public.learning_fields lf2 ON lf2.id = cmp.learning_field_id
            WHERE lf2.curriculum_id = cu.id
          ),
          'learning_fields', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'code', lf3.code, 'title', lf3.title, 'weight_percent', lf3.weight_percent
            ) ORDER BY lf3.code)
            FROM public.learning_fields lf3 WHERE lf3.curriculum_id = cu.id
          ), '[]'::jsonb)
        ) AS curr
        FROM public.curricula cu
        WHERE cu.certification_id IN (
          SELECT DISTINCT cc.linked_certification_id
          FROM public.certification_catalog cc
          WHERE v.vertical_slug = ANY(cc.vertical_slugs)
            AND cc.linked_certification_id IS NOT NULL
        )
      ) sub
    ), '[]'::jsonb)
  );

  RETURN result;
END;
$function$;