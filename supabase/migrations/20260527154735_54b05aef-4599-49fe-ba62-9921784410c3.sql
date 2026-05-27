
CREATE OR REPLACE VIEW public.v_vertical_occupational_intelligence AS
WITH cert_per_vertical AS (
  SELECT
    v.vertical_slug,
    v.name AS vertical_name,
    v.industry_key,
    cc.id   AS catalog_id,
    cc.linked_certification_id AS certification_id
  FROM public.vertical_dna v
  LEFT JOIN public.certification_catalog cc
    ON v.vertical_slug = ANY(cc.vertical_slugs)
  WHERE v.is_active = true
    AND v.vertical_slug IS NOT NULL
),
curr_per_vertical AS (
  SELECT cpv.vertical_slug, cpv.vertical_name, cpv.industry_key,
         cpv.catalog_id, c.id AS curriculum_id
  FROM cert_per_vertical cpv
  LEFT JOIN public.curricula c
    ON c.certification_id = cpv.certification_id
)
SELECT
  cpv.vertical_slug,
  cpv.vertical_name,
  cpv.industry_key,
  COUNT(DISTINCT cpv.catalog_id)    FILTER (WHERE cpv.catalog_id IS NOT NULL)    AS certifications_count,
  COUNT(DISTINCT cpv.curriculum_id) FILTER (WHERE cpv.curriculum_id IS NOT NULL) AS curricula_count,
  COUNT(DISTINCT lf.id)                                                          AS learning_fields_count,
  COUNT(DISTINCT comp.id)                                                        AS competencies_count,
  COUNT(DISTINCT eb.id)                                                          AS blueprints_count
FROM curr_per_vertical cpv
LEFT JOIN public.learning_fields lf ON lf.curriculum_id = cpv.curriculum_id
LEFT JOIN public.competencies comp ON comp.learning_field_id = lf.id
LEFT JOIN public.exam_blueprints eb ON eb.curriculum_id = cpv.curriculum_id
GROUP BY cpv.vertical_slug, cpv.vertical_name, cpv.industry_key;

GRANT SELECT ON public.v_vertical_occupational_intelligence TO anon, authenticated, service_role;
