-- A3.1: Fix tautological EXISTS subqueries in persona-landing ↔ cert-pillar candidates view
CREATE OR REPLACE VIEW public.v_persona_landing_cert_pillar_link_candidates AS
WITH cert_route AS (
  SELECT csp.id AS cert_pillar_id,
         cc.id AS catalog_id,
         cc.linked_certification_id AS cert_id,
         cc.slug AS cert_slug,
         csp.title AS cert_title,
         CASE cc.catalog_type
           WHEN 'Ausbildung'         THEN 'ausbildung'
           WHEN 'Fortbildung_IHK'    THEN 'fachwirt'
           WHEN 'Fortbildung_HWK'    THEN 'fachwirt'
           WHEN 'Meister'            THEN 'meister'
           WHEN 'Sachkunde'          THEN 'sachkunde'
           WHEN 'Branchenzertifikat' THEN 'sachkunde'
           WHEN 'Projektmanagement'  THEN 'projektmanagement'
           ELSE NULL
         END AS route_prefix
    FROM certification_seo_pages csp
    JOIN certification_catalog cc ON cc.id = csp.certification_catalog_id
   WHERE csp.is_published = true
),
src AS (
  SELECT sp.id AS persona_page_id,
         sp.slug AS persona_slug,
         sp.title AS persona_title,
         sp.persona_type,
         sp.package_id,
         cp.certification_id,
         '/' || sp.slug AS source_url
    FROM seo_content_pages sp
    LEFT JOIN course_packages cp ON cp.id = sp.package_id
   WHERE sp.page_type = 'persona_landing' AND sp.status = 'published'
),
joined AS (
  SELECT src.persona_page_id, src.persona_slug, src.persona_title, src.persona_type,
         src.package_id, src.certification_id, src.source_url,
         cr.cert_pillar_id, cr.cert_slug, cr.cert_title, cr.route_prefix,
         CASE
           WHEN cr.route_prefix IS NOT NULL AND cr.cert_slug IS NOT NULL
             THEN '/' || cr.route_prefix || '/' || cr.cert_slug
           ELSE NULL
         END AS target_url,
         count(cr.cert_pillar_id) OVER (PARTITION BY src.persona_page_id) AS pillar_match_count
    FROM src
    LEFT JOIN cert_route cr ON cr.cert_id = src.certification_id
)
SELECT j.persona_page_id, j.persona_slug, j.persona_title, j.persona_type,
       j.package_id, j.certification_id, j.cert_pillar_id, j.cert_slug, j.cert_title,
       j.route_prefix, j.source_url, j.target_url,
  CASE
    WHEN j.persona_type <> ALL (ARRAY['azubi','betrieb','institution']) THEN 'INVALID_PERSONA_ROUTE'
    WHEN j.cert_pillar_id IS NULL THEN 'NO_CERT_MAPPING'
    WHEN j.route_prefix IS NULL THEN 'UNROUTED_CATALOG_TYPE'
    WHEN j.pillar_match_count > 1 THEN 'AMBIGUOUS_ROUTE'
    WHEN (EXISTS (SELECT 1 FROM seo_internal_link_suggestions s
                   WHERE s.source_url = j.source_url AND s.target_url = j.target_url
                     AND s.link_type = 'cluster_to_pillar' AND s.status = 'active'))
     AND (EXISTS (SELECT 1 FROM seo_internal_link_suggestions s
                   WHERE s.source_url = j.target_url AND s.target_url = j.source_url
                     AND s.link_type = 'pillar_to_cluster' AND s.status = 'active'))
      THEN 'ALREADY_ACTIVE'
    WHEN (EXISTS (SELECT 1 FROM seo_internal_link_suggestions s
                   WHERE s.source_url = j.source_url AND s.target_url = j.target_url
                     AND s.link_type = 'cluster_to_pillar'))
     AND (EXISTS (SELECT 1 FROM seo_internal_link_suggestions s
                   WHERE s.source_url = j.target_url AND s.target_url = j.source_url
                     AND s.link_type = 'pillar_to_cluster'))
      THEN 'ALREADY_SUGGESTED'
    ELSE 'READY_TO_SUGGEST'
  END AS decision
FROM joined j;

REVOKE ALL ON public.v_persona_landing_cert_pillar_link_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_persona_landing_cert_pillar_link_candidates TO service_role;