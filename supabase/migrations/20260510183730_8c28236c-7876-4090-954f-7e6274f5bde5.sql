-- ============================================================
-- WELLE 4 — Growth Quality Gate + Retention Config
-- ============================================================

-- 1. Quality Score view per published package
CREATE OR REPLACE VIEW public.v_growth_quality_scores AS
WITH pkgs AS (
  SELECT id AS package_id, curriculum_id, title, package_key, feature_flags, published_at
  FROM public.course_packages
  WHERE status = 'published'
),
blog AS (
  SELECT
    source_package_id AS package_id,
    bool_or(coalesce(word_count,0) >= 600)              AS has_long_form,
    bool_or(coalesce(meta_description,'') <> '')        AS has_meta_desc,
    bool_or(coalesce(hero_image_url,'') <> '')          AS has_hero,
    bool_or(coalesce(target_keyword,'') <> '')          AS has_target_kw,
    bool_or(coalesce(canonical_url,'') <> '')           AS has_canonical,
    bool_or(jsonb_typeof(faq_json) = 'array' AND jsonb_array_length(faq_json) > 0) AS has_faq,
    bool_or(jsonb_typeof(internal_links_json) = 'array' AND jsonb_array_length(internal_links_json) > 0) AS has_inlinks_json,
    bool_or(coalesce(og_image_url,'') <> '')            AS has_blog_og,
    count(*) AS blog_count
  FROM public.blog_articles
  WHERE source_package_id IS NOT NULL
    AND status IN ('published','generated','draft')
  GROUP BY 1
),
ca AS (
  SELECT
    curriculum_id,
    count(*) AS total_assets,
    count(*) FILTER (
      WHERE asset_type ILIKE '%cta%'
         OR coalesce(content_markdown,'') ILIKE '%cta%'
         OR coalesce(content_json::text,'') ILIKE '%"cta"%'
    ) AS cta_assets
  FROM public.campaign_assets
  WHERE curriculum_id IS NOT NULL
  GROUP BY 1
),
dt AS (
  SELECT curriculum_id, count(*) AS n
  FROM public.distribution_targets
  WHERE curriculum_id IS NOT NULL
  GROUP BY 1
),
ev AS (
  SELECT
    package_id,
    count(*) FILTER (WHERE event_type IN ('page_view','quiz_started','lead_captured')) AS view_events,
    count(DISTINCT event_type) AS distinct_event_types
  FROM public.conversion_events
  WHERE package_id IS NOT NULL
    AND created_at > now() - interval '30 days'
  GROUP BY 1
),
seq AS (
  SELECT count(*) AS n FROM public.email_sequences
),
ix AS (
  SELECT DISTINCT package_id
  FROM public.job_queue
  WHERE job_type='seo_indexnow_submit' AND status='completed' AND package_id IS NOT NULL
),
sm AS (
  SELECT DISTINCT package_id
  FROM public.job_queue
  WHERE job_type='seo_sitemap_refresh' AND status='completed' AND package_id IS NOT NULL
),
il AS (
  SELECT DISTINCT package_id
  FROM public.job_queue
  WHERE job_type='seo_internal_links' AND status='completed' AND package_id IS NOT NULL
)
SELECT
  p.package_id,
  p.curriculum_id,
  p.title,
  p.package_key,
  p.published_at,

  -- 1) Blog Quality 0..100
  CASE WHEN b.package_id IS NULL THEN 0 ELSE
    ((b.has_long_form::int + b.has_meta_desc::int + b.has_hero::int +
      b.has_target_kw::int + b.has_faq::int + b.has_inlinks_json::int) * 100 / 6)
  END AS score_blog_quality,

  -- 2) SEO Meta 0..100
  CASE WHEN b.package_id IS NULL THEN 0 ELSE
    ((b.has_meta_desc::int + b.has_canonical::int + b.has_blog_og::int + b.has_target_kw::int) * 100 / 4)
  END AS score_seo_meta,

  -- 3) Internal Links 0..100
  CASE
    WHEN il.package_id IS NOT NULL AND coalesce(b.has_inlinks_json,false) THEN 100
    WHEN il.package_id IS NOT NULL OR coalesce(b.has_inlinks_json,false) THEN 60
    ELSE 0
  END AS score_internal_links,

  -- 4) CTA presence 0..100
  CASE
    WHEN coalesce(ca.cta_assets,0) >= 2 THEN 100
    WHEN coalesce(ca.cta_assets,0) = 1 THEN 60
    ELSE 0
  END AS score_cta,

  -- 5) Funnel events wired 0..100
  CASE
    WHEN coalesce(ev.distinct_event_types,0) >= 3 THEN 100
    WHEN coalesce(ev.distinct_event_types,0) = 2 THEN 70
    WHEN coalesce(ev.view_events,0) > 0 THEN 40
    ELSE 0
  END AS score_funnel_events,

  -- 6) Email sequence content available 0..100
  CASE WHEN coalesce(seq.n,0) >= 4 THEN 100 WHEN coalesce(seq.n,0) > 0 THEN 60 ELSE 0 END AS score_email_sequence,

  -- 7) Distribution 0..100
  CASE
    WHEN coalesce(dt.n,0) >= 3 THEN 100
    WHEN coalesce(dt.n,0) >= 1 THEN 60
    ELSE 0
  END AS score_distribution,

  -- 8) OG image (package-level usable) 0..100
  CASE
    WHEN NULLIF(p.feature_flags->>'og_image_url','') IS NOT NULL THEN 100
    WHEN coalesce(b.has_blog_og,false) THEN 60
    ELSE 0
  END AS score_og_image,

  -- raw signals for drilldown
  coalesce(b.blog_count,0) AS blog_count,
  coalesce(ca.total_assets,0) AS campaign_assets_count,
  coalesce(ca.cta_assets,0) AS cta_assets_count,
  coalesce(dt.n,0) AS distribution_targets_count,
  coalesce(ev.view_events,0) AS funnel_events_30d,
  coalesce(ev.distinct_event_types,0) AS funnel_event_types_30d
FROM pkgs p
LEFT JOIN blog b ON b.package_id = p.package_id
LEFT JOIN ca   ON ca.curriculum_id = p.curriculum_id
LEFT JOIN dt   ON dt.curriculum_id = p.curriculum_id
LEFT JOIN ev   ON ev.package_id    = p.package_id
LEFT JOIN ix   ON ix.package_id    = p.package_id
LEFT JOIN sm   ON sm.package_id    = p.package_id
LEFT JOIN il   ON il.package_id    = p.package_id
LEFT JOIN seq  ON true;

REVOKE ALL ON public.v_growth_quality_scores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_growth_quality_scores TO service_role;

-- 2. Aggregate scoring helper
CREATE OR REPLACE FUNCTION public.fn_compute_growth_quality_score(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'package_id', s.package_id,
    'title', s.title,
    'package_key', s.package_key,
    'subscores', jsonb_build_object(
      'blog_quality', s.score_blog_quality,
      'seo_meta', s.score_seo_meta,
      'internal_links', s.score_internal_links,
      'cta', s.score_cta,
      'funnel_events', s.score_funnel_events,
      'email_sequence', s.score_email_sequence,
      'distribution', s.score_distribution,
      'og_image', s.score_og_image
    ),
    'growth_quality_score',
      ((s.score_blog_quality + s.score_seo_meta + s.score_internal_links +
        s.score_cta + s.score_funnel_events + s.score_email_sequence +
        s.score_distribution + s.score_og_image) / 8),
    'signals', jsonb_build_object(
      'blog_count', s.blog_count,
      'campaign_assets_count', s.campaign_assets_count,
      'cta_assets_count', s.cta_assets_count,
      'distribution_targets_count', s.distribution_targets_count,
      'funnel_events_30d', s.funnel_events_30d,
      'funnel_event_types_30d', s.funnel_event_types_30d
    )
  )
  FROM public.v_growth_quality_scores s
  WHERE s.package_id = p_package_id;
$$;

-- 3. Admin RPC: aggregate summary
CREATE OR REPLACE FUNCTION public.admin_get_growth_quality_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  WITH s AS (
    SELECT
      package_id,
      ((score_blog_quality + score_seo_meta + score_internal_links +
        score_cta + score_funnel_events + score_email_sequence +
        score_distribution + score_og_image) / 8) AS total,
      score_blog_quality, score_seo_meta, score_internal_links, score_cta,
      score_funnel_events, score_email_sequence, score_distribution, score_og_image
    FROM public.v_growth_quality_scores
  )
  SELECT jsonb_build_object(
    'total_published', count(*),
    'avg_score', round(coalesce(avg(total),0)::numeric, 1),
    'green_count',  count(*) FILTER (WHERE total >= 80),
    'yellow_count', count(*) FILTER (WHERE total >= 50 AND total < 80),
    'red_count',    count(*) FILTER (WHERE total < 50),
    'avg_subscores', jsonb_build_object(
      'blog_quality',   round(coalesce(avg(score_blog_quality),0)::numeric,1),
      'seo_meta',       round(coalesce(avg(score_seo_meta),0)::numeric,1),
      'internal_links', round(coalesce(avg(score_internal_links),0)::numeric,1),
      'cta',            round(coalesce(avg(score_cta),0)::numeric,1),
      'funnel_events',  round(coalesce(avg(score_funnel_events),0)::numeric,1),
      'email_sequence', round(coalesce(avg(score_email_sequence),0)::numeric,1),
      'distribution',   round(coalesce(avg(score_distribution),0)::numeric,1),
      'og_image',       round(coalesce(avg(score_og_image),0)::numeric,1)
    ),
    'computed_at', now()
  ) INTO v_result
  FROM s;

  RETURN coalesce(v_result, jsonb_build_object('total_published',0));
END;
$$;

-- 4. Admin RPC: per-package details
CREATE OR REPLACE FUNCTION public.admin_get_growth_quality_details(p_limit integer DEFAULT 50, p_min integer DEFAULT 0, p_max integer DEFAULT 100)
RETURNS TABLE(
  package_id uuid, title text, package_key text, published_at timestamptz,
  growth_quality_score integer,
  score_blog_quality integer, score_seo_meta integer, score_internal_links integer,
  score_cta integer, score_funnel_events integer, score_email_sequence integer,
  score_distribution integer, score_og_image integer,
  blog_count integer, campaign_assets_count integer, cta_assets_count integer,
  distribution_targets_count integer, funnel_events_30d integer, funnel_event_types_30d integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  SELECT
    s.package_id, s.title, s.package_key, s.published_at,
    ((s.score_blog_quality + s.score_seo_meta + s.score_internal_links +
      s.score_cta + s.score_funnel_events + s.score_email_sequence +
      s.score_distribution + s.score_og_image) / 8) AS growth_quality_score,
    s.score_blog_quality, s.score_seo_meta, s.score_internal_links,
    s.score_cta, s.score_funnel_events, s.score_email_sequence,
    s.score_distribution, s.score_og_image,
    s.blog_count::int, s.campaign_assets_count::int, s.cta_assets_count::int,
    s.distribution_targets_count::int, s.funnel_events_30d::int, s.funnel_event_types_30d::int
  FROM public.v_growth_quality_scores s
  WHERE ((s.score_blog_quality + s.score_seo_meta + s.score_internal_links +
          s.score_cta + s.score_funnel_events + s.score_email_sequence +
          s.score_distribution + s.score_og_image) / 8) BETWEEN p_min AND p_max
  ORDER BY growth_quality_score ASC, s.published_at DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
END;
$$;

-- 5. Retention config in admin_settings (default 90)
INSERT INTO public.admin_settings (key, value, description)
VALUES (
  'post_publish_growth_health_retention_days',
  to_jsonb(90),
  'Tage, die Growth-Health-Snapshots aufbewahrt werden (>=7).'
)
ON CONFLICT (key) DO NOTHING;

-- Cleanup function reads setting when no override is passed
CREATE OR REPLACE FUNCTION public.fn_cleanup_post_publish_growth_health_snapshots(p_retain_days integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
  v_setting integer;
  v_effective integer;
  v_cutoff timestamptz;
BEGIN
  SELECT GREATEST(coalesce((value)::int, 90), 7) INTO v_setting
  FROM public.admin_settings
  WHERE key = 'post_publish_growth_health_retention_days';

  v_effective := GREATEST(coalesce(p_retain_days, v_setting, 90), 7);
  v_cutoff := now() - make_interval(days => v_effective);

  DELETE FROM public.post_publish_growth_health_snapshots WHERE run_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'post_publish_growth_health_snapshot_cleanup',
    'system',
    CASE WHEN v_deleted > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'deleted', v_deleted,
      'retain_days_param', p_retain_days,
      'retain_days_setting', v_setting,
      'retain_days_effective', v_effective,
      'cutoff', v_cutoff
    )
  );

  RETURN v_deleted;
END;
$$;

-- 6. Status RPC for retention/cleanup
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_cleanup_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_setting integer;
  v_last jsonb;
  v_count bigint;
  v_oldest timestamptz;
  v_newest timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  SELECT GREATEST(coalesce((value)::int, 90), 7) INTO v_setting
  FROM public.admin_settings
  WHERE key = 'post_publish_growth_health_retention_days';

  SELECT jsonb_build_object(
    'created_at', created_at,
    'result_status', result_status,
    'metadata', metadata
  )
  INTO v_last
  FROM public.auto_heal_log
  WHERE action_type = 'post_publish_growth_health_snapshot_cleanup'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT count(*), min(run_at), max(run_at)
    INTO v_count, v_oldest, v_newest
  FROM public.post_publish_growth_health_snapshots;

  RETURN jsonb_build_object(
    'retain_days', coalesce(v_setting, 90),
    'last_cleanup', v_last,
    'snapshot_count', v_count,
    'oldest_snapshot_at', v_oldest,
    'newest_snapshot_at', v_newest
  );
END;
$$;

-- 7. Setter for retention (admin-gated, validates >=7)
CREATE OR REPLACE FUNCTION public.admin_set_post_publish_growth_retention_days(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  IF p_days IS NULL OR p_days < 7 OR p_days > 3650 THEN
    RAISE EXCEPTION 'invalid_retention_days: must be between 7 and 3650';
  END IF;

  RETURN public.admin_set_setting('post_publish_growth_health_retention_days', to_jsonb(p_days));
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION public.fn_compute_growth_quality_score(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_growth_quality_score(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_get_growth_quality_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_quality_details(integer,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_growth_cleanup_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_post_publish_growth_retention_days(integer) TO authenticated;