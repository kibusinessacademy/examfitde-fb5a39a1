CREATE OR REPLACE VIEW public.v_cornerstone_blog_score AS
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
  LEAST(1.0, COALESCE(word_count, 0)::numeric / 1800.0) AS s_depth,
  LEAST(1.0, jsonb_array_length(COALESCE(faq_json, '[]'::jsonb))::numeric / 6.0) AS s_faq,
  CASE WHEN content_quality_signals IS NOT NULL AND content_quality_signals <> '{}'::jsonb THEN 1.0 ELSE 0.0 END AS s_quality,
  CASE WHEN hero_image_url IS NOT NULL THEN 1.0 ELSE 0.0 END AS s_hero,
  LEAST(1.0, jsonb_array_length(COALESCE(internal_links_json, '[]'::jsonb))::numeric / 4.0) AS s_anchor,
  CASE WHEN is_winner THEN 1.0 ELSE 0.0 END AS s_winner,
  LEAST(1.0, COALESCE(total_views, 0)::numeric / 500.0) AS s_views,
  LEAST(1.0, COALESCE(performance_score, 0::numeric)) AS s_perf,
  LEAST(1.00, GREATEST(0.00,
      0.29 * LEAST(1.0, COALESCE(word_count, 0)::numeric / 1800.0)
    + 0.15 * LEAST(1.0, jsonb_array_length(COALESCE(faq_json, '[]'::jsonb))::numeric / 6.0)
    + 0.20 * (CASE WHEN content_quality_signals IS NOT NULL AND content_quality_signals <> '{}'::jsonb THEN 1 ELSE 0 END)::numeric
    + 0.15 * (CASE WHEN hero_image_url IS NOT NULL THEN 1 ELSE 0 END)::numeric
    + 0.15 * LEAST(1.0, jsonb_array_length(COALESCE(internal_links_json, '[]'::jsonb))::numeric / 4.0)
    + 0.02 * (CASE WHEN is_winner THEN 1 ELSE 0 END)::numeric
    + 0.02 * LEAST(1.0, COALESCE(total_views, 0)::numeric / 500.0)
    + 0.02 * LEAST(1.0, COALESCE(performance_score, 0::numeric))
  ))::numeric(5,4) AS cornerstone_score
FROM public.blog_articles ba
WHERE status = 'published';

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'cornerstone_blog_score_v2_deployed',
  ARRAY['version','weights','prior_top_score','prior_pass_count'],
  'seo.cornerstone'
)
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE
  v_prior_top numeric;
  v_prior_pass int;
BEGIN
  SELECT MAX(cornerstone_score), COUNT(*) FILTER (WHERE cornerstone_score >= 0.60)
    INTO v_prior_top, v_prior_pass
  FROM public.v_cornerstone_blog_score;

  PERFORM public.fn_emit_audit(
    'cornerstone_blog_score_v2_deployed',
    'system',
    NULL,
    'success',
    jsonb_build_object(
      'version', 'v2',
      'weights', jsonb_build_object(
        'depth', 0.29, 'quality', 0.20, 'faq', 0.15, 'hero', 0.15, 'anchor', 0.15,
        'winner', 0.02, 'views', 0.02, 'perf', 0.02
      ),
      'prior_top_score', v_prior_top,
      'prior_pass_count', v_prior_pass,
      'rationale', 'Hero+anchor now pipeline-filled; reduce weight on structurally-unmeasured winner/views/perf'
    ),
    'migration:e3e_5b_cornerstone_v2',
    NULL
  );
END $$;