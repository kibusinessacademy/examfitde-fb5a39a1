-- Phase 2 Step 1: Final decommission of seo_sitemap_refresh
-- Reason: sitemap is global (one XML per domain). generate-sitemap is an HTTP
-- frontend that returns XML, not a JSON worker — it always classified as
-- EMPTY_RESULT in content-runner, looping forever. Producer was already
-- patched (migration 20260511072747). This wave removes the type structurally
-- from the coverage view, registry and policies so no detector path can
-- reintroduce it.

-- 1) Drop has_sitemap_refresh column from coverage view
DROP VIEW IF EXISTS public.v_post_publish_growth_coverage CASCADE;

CREATE VIEW public.v_post_publish_growth_coverage AS
WITH pkgs AS (
  SELECT id AS package_id, curriculum_id, title, package_key, feature_flags, published_at
  FROM course_packages WHERE status = 'published'
),
blog AS (
  SELECT DISTINCT source_package_id AS package_id
  FROM blog_articles
  WHERE source_package_id IS NOT NULL
    AND status = ANY (ARRAY['published','generated','draft'])
),
camp_assets AS (
  SELECT curriculum_id, count(*) AS n FROM campaign_assets
  WHERE curriculum_id IS NOT NULL GROUP BY curriculum_id
),
dist AS (
  SELECT curriculum_id, count(*) AS n FROM distribution_targets
  WHERE curriculum_id IS NOT NULL GROUP BY curriculum_id
),
ix AS (
  SELECT DISTINCT package_id FROM job_queue
  WHERE job_type = 'seo_indexnow_submit' AND status = 'completed' AND package_id IS NOT NULL
),
il AS (
  SELECT DISTINCT package_id FROM job_queue
  WHERE job_type = 'seo_internal_links' AND status = 'completed' AND package_id IS NOT NULL
)
SELECT
  p.package_id, p.curriculum_id, p.title, p.package_key, p.published_at,
  (b.package_id IS NOT NULL) AS has_blog,
  (NULLIF(p.feature_flags ->> 'og_image_url', '') IS NOT NULL) AS has_og_image,
  (ix.package_id IS NOT NULL) AS has_indexnow,
  (il.package_id IS NOT NULL) AS has_internal_links,
  COALESCE(ca.n, 0) AS campaign_assets_count,
  COALESCE(dt.n, 0) AS distribution_targets_count,
  (COALESCE(ca.n, 0) > 0) AS has_campaign_assets,
  (COALESCE(dt.n, 0) > 0) AS has_distribution_targets
FROM pkgs p
LEFT JOIN blog b ON b.package_id = p.package_id
LEFT JOIN ix ON ix.package_id = p.package_id
LEFT JOIN il ON il.package_id = p.package_id
LEFT JOIN camp_assets ca ON ca.curriculum_id = p.curriculum_id
LEFT JOIN dist dt ON dt.curriculum_id = p.curriculum_id;

REVOKE ALL ON public.v_post_publish_growth_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_post_publish_growth_coverage TO service_role;

-- 2) Remove from job_type_policies
DELETE FROM public.job_type_policies WHERE job_type = 'seo_sitemap_refresh';

-- 3) Remove from ops_job_type_registry (idempotent)
DELETE FROM public.ops_job_type_registry WHERE job_type = 'seo_sitemap_refresh';

-- 4) Audit
INSERT INTO public.auto_heal_log (action_type, result_status, result_detail, metadata)
VALUES (
  'sitemap_refresh_decommissioned',
  'success',
  'Removed seo_sitemap_refresh from coverage view + registry + policies. Sitemap is global on-demand via /functions/v1/generate-sitemap.',
  jsonb_build_object(
    'phase', 'growth_wave_phase_2',
    'removed_from', jsonb_build_array('v_post_publish_growth_coverage','job_type_policies','ops_job_type_registry'),
    'rollback_hint', 'restore CTE+column in view; reinsert registry/policies row; only do so once a real per-package handler exists'
  )
);

-- 5) Smoke: verify no path remains
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining FROM public.job_type_policies WHERE job_type='seo_sitemap_refresh';
  IF v_remaining > 0 THEN RAISE EXCEPTION 'Decommission incomplete: job_type_policies still has row'; END IF;
  SELECT count(*) INTO v_remaining FROM public.ops_job_type_registry WHERE job_type='seo_sitemap_refresh';
  IF v_remaining > 0 THEN RAISE EXCEPTION 'Decommission incomplete: ops_job_type_registry still has row'; END IF;
END $$;