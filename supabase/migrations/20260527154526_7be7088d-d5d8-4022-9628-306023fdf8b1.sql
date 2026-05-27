
CREATE OR REPLACE VIEW public.v_vertical_occupational_intelligence AS
WITH cert_per_vertical AS (
  SELECT
    v.vertical_slug,
    v.name AS vertical_name,
    v.industry_key,
    cc.id              AS catalog_id,
    cc.linked_certification_id AS curriculum_id
  FROM public.vertical_dna v
  LEFT JOIN public.certification_catalog cc
    ON v.vertical_slug = ANY(cc.vertical_slugs)
  WHERE v.is_active = true
    AND v.vertical_slug IS NOT NULL
),
agg AS (
  SELECT
    cpv.vertical_slug,
    cpv.vertical_name,
    cpv.industry_key,
    COUNT(DISTINCT cpv.catalog_id)    FILTER (WHERE cpv.catalog_id IS NOT NULL)    AS certifications_count,
    COUNT(DISTINCT cpv.curriculum_id) FILTER (WHERE cpv.curriculum_id IS NOT NULL) AS curricula_count,
    COUNT(DISTINCT lf.id)                                                          AS learning_fields_count,
    COUNT(DISTINCT comp.id)                                                        AS competencies_count,
    COUNT(DISTINCT eb.id)                                                          AS blueprints_count
  FROM cert_per_vertical cpv
  LEFT JOIN public.learning_fields lf ON lf.curriculum_id = cpv.curriculum_id
  LEFT JOIN public.competencies comp ON comp.learning_field_id = lf.id
  LEFT JOIN public.exam_blueprints eb ON eb.curriculum_id = cpv.curriculum_id
  GROUP BY cpv.vertical_slug, cpv.vertical_name, cpv.industry_key
)
SELECT * FROM agg;

COMMENT ON VIEW public.v_vertical_occupational_intelligence IS
'Bridge-View: aggregiert pro Vertical die Counts aus Certification-Catalog, Curricula, Lernfeldern, Kompetenzen, Blueprints. Read-only Bridge auf bestehende SSOT.';

GRANT SELECT ON public.v_vertical_occupational_intelligence TO anon, authenticated, service_role;

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
           cc.recognition_type, cc.track, cc.linked_certification_id AS curriculum_id
    FROM public.certification_catalog cc
    WHERE _vertical_slug = ANY(cc.vertical_slugs)
    ORDER BY cc.priority_score DESC, cc.title ASC
  ),
  curr AS (
    SELECT DISTINCT c.id, c.title, c.status::text AS status, c.track::text AS track,
           c.certification_type::text AS certification_type
    FROM public.curricula c
    WHERE c.id IN (SELECT curriculum_id FROM certs WHERE curriculum_id IS NOT NULL)
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
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    WHERE lf.curriculum_id IN (SELECT id FROM curr)
    GROUP BY lf.curriculum_id
  ),
  summary AS (
    SELECT
      (SELECT certifications_count   FROM public.v_vertical_occupational_intelligence WHERE vertical_slug = _vertical_slug) AS certifications_count,
      (SELECT curricula_count        FROM public.v_vertical_occupational_intelligence WHERE vertical_slug = _vertical_slug) AS curricula_count,
      (SELECT learning_fields_count  FROM public.v_vertical_occupational_intelligence WHERE vertical_slug = _vertical_slug) AS learning_fields_count,
      (SELECT competencies_count     FROM public.v_vertical_occupational_intelligence WHERE vertical_slug = _vertical_slug) AS competencies_count,
      (SELECT blueprints_count       FROM public.v_vertical_occupational_intelligence WHERE vertical_slug = _vertical_slug) AS blueprints_count
  )
  SELECT jsonb_build_object(
    'vertical', (SELECT to_jsonb(d) FROM dna d),
    'summary',  (SELECT to_jsonb(s) FROM summary s),
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

COMMENT ON FUNCTION public.get_vertical_occupational_dna(TEXT) IS
'Liefert vollständige Berufs-DNA für eine Vertical: DNA + Certifications + Curricula + Lernfelder + Kompetenz-Counts + Blueprints. Read-only Bridge.';

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('vertical_occupational_dna_read',
   ARRAY['vertical_slug','certifications_count','curricula_count']::text[],
   'berufs-ki/vertical-bridge')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module,
      updated_at = now();
