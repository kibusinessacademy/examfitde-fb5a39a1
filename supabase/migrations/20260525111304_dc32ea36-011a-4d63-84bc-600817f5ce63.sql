
-- Recalibrate v_cornerstone_blog_score (E3e.5b)
DROP VIEW IF EXISTS public.v_cornerstone_blog_score CASCADE;

CREATE VIEW public.v_cornerstone_blog_score AS
SELECT
  id AS blog_article_id,
  slug AS blog_slug,
  title AS blog_title,
  source_curriculum_id,
  source_package_id,
  word_count,
  is_winner,
  total_views,
  performance_score,
  -- Component scores
  LEAST(1.0, COALESCE(word_count, 0)::numeric / 1800.0) AS s_depth,
  LEAST(1.0, jsonb_array_length(COALESCE(faq_json, '[]'::jsonb))::numeric / 6.0) AS s_faq,
  CASE WHEN content_quality_signals IS NOT NULL AND content_quality_signals <> '{}'::jsonb THEN 1.0 ELSE 0.0 END AS s_quality,
  CASE WHEN hero_image_url IS NOT NULL THEN 1.0 ELSE 0.0 END AS s_hero,
  -- s_anchor v2: internal-link-density (0..1, full credit at >=4 links). Was: competency_id IS NOT NULL (0/256 coverage).
  LEAST(1.0, jsonb_array_length(COALESCE(internal_links_json, '[]'::jsonb))::numeric / 4.0) AS s_anchor,
  CASE WHEN is_winner THEN 1.0 ELSE 0.0 END AS s_winner,
  LEAST(1.0, COALESCE(total_views, 0)::numeric / 500.0) AS s_views,
  LEAST(1.0, COALESCE(performance_score, 0)::numeric) AS s_perf,
  -- Composite (weights sum = 1.00)
  LEAST(1.00, GREATEST(0.00,
      0.25 * LEAST(1.0, COALESCE(word_count, 0)::numeric / 1800.0)
    + 0.15 * LEAST(1.0, jsonb_array_length(COALESCE(faq_json, '[]'::jsonb))::numeric / 6.0)
    + 0.15 * CASE WHEN content_quality_signals IS NOT NULL AND content_quality_signals <> '{}'::jsonb THEN 1 ELSE 0 END::numeric
    + 0.15 * CASE WHEN hero_image_url IS NOT NULL THEN 1 ELSE 0 END::numeric
    + 0.15 * LEAST(1.0, jsonb_array_length(COALESCE(internal_links_json, '[]'::jsonb))::numeric / 4.0)
    + 0.05 * CASE WHEN is_winner THEN 1 ELSE 0 END::numeric
    + 0.05 * LEAST(1.0, COALESCE(total_views, 0)::numeric / 500.0)
    + 0.05 * LEAST(1.0, COALESCE(performance_score, 0)::numeric)
  ))::numeric(5,4) AS cornerstone_score
FROM public.blog_articles ba
WHERE status = 'published';

REVOKE ALL ON public.v_cornerstone_blog_score FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cornerstone_blog_score TO service_role;

-- Audit the recalibration
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata, trigger_source)
VALUES ('cornerstone_score_recalibrated', 'system', 'v_cornerstone_blog_score', 'success',
        'E3e.5b: weights rebalanced (winner/views/perf 0.10→0.05; quality/hero/anchor 0.10→0.15); s_anchor proxy changed to internal_links count.',
        jsonb_build_object(
          'version', 'v2',
          'weights', jsonb_build_object('depth',0.25,'faq',0.15,'quality',0.15,'hero',0.15,'anchor',0.15,'winner',0.05,'views',0.05,'perf',0.05),
          's_anchor_proxy', 'jsonb_array_length(internal_links_json) / 4',
          'rationale', 'Top-30 baseline 2026-05-25 stuck at 0.40 due to 0% hero + 0% competency_id coverage. Recalibration restores 0.60 reachability after hero+4 internal links delivery.'
        ),
        'migration_e3e5b');
