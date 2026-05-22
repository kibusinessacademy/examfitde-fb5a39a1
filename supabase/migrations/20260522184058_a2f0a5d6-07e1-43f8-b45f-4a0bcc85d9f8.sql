
CREATE OR REPLACE VIEW public.v_pillar_orphans AS
SELECT
  p.id,
  p.slug,
  p.intent_key,
  p.source_package_id,
  p.status,
  CASE
    WHEN p.source_package_id IS NULL THEN 'NO_SOURCE_PACKAGE'
    WHEN cp.id IS NULL THEN 'SOURCE_PACKAGE_MISSING'
    WHEN cp.status <> 'published' THEN 'SOURCE_PACKAGE_PENDING_PUBLISH'
    ELSE 'OK'
  END AS orphan_reason
FROM public.v_seo_pillars p
LEFT JOIN public.course_packages cp ON cp.id = p.source_package_id
LEFT JOIN public.blog_articles ba ON ba.id = p.id
WHERE
  -- SEO-only classification = resolved (not an orphan)
  COALESCE((ba.entity_data->>'seo_only_classification')::bool, false) = false
  AND (
    p.source_package_id IS NULL
    OR cp.id IS NULL
    OR cp.status <> 'published'
  );

CREATE OR REPLACE VIEW public.v_pillar_orphan_classification AS
SELECT
  ba.id AS pillar_id,
  ba.slug,
  ba.title,
  ba.source_package_id,
  cp.package_key,
  cp.status AS package_status,
  CASE
    WHEN COALESCE((ba.entity_data->>'seo_only_classification')::bool, false) THEN 'SEO_ONLY'
    WHEN ba.source_package_id IS NULL THEN 'UNCLASSIFIED'
    WHEN cp.id IS NULL THEN 'BROKEN_LINK'
    WHEN cp.status <> 'published' THEN 'PENDING_PUBLISH'
    ELSE 'LINKED_PUBLISHED'
  END AS classification,
  ba.entity_data->>'seo_only_reason' AS seo_only_reason,
  ba.entity_data->>'classification_decision' AS decision
FROM public.blog_articles ba
LEFT JOIN public.course_packages cp ON cp.id = ba.source_package_id
WHERE ba.article_type = 'pillar_guide';

REVOKE ALL ON public.v_pillar_orphan_classification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_orphan_classification TO service_role;
