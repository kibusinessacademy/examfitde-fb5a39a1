-- 1) Snapshot table
CREATE TABLE IF NOT EXISTS public.post_publish_growth_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  total_published integer NOT NULL DEFAULT 0,
  coverage_blog_pct numeric(5,2) NOT NULL DEFAULT 0,
  coverage_og_image_pct numeric(5,2) NOT NULL DEFAULT 0,
  coverage_indexnow_pct numeric(5,2) NOT NULL DEFAULT 0,
  coverage_sitemap_pct numeric(5,2) NOT NULL DEFAULT 0,
  coverage_internal_links_pct numeric(5,2) NOT NULL DEFAULT 0,
  coverage_campaign_assets_pct numeric(5,2) NOT NULL DEFAULT 0,
  coverage_distribution_pct numeric(5,2) NOT NULL DEFAULT 0,
  stuck_pending_count integer NOT NULL DEFAULT 0,
  stuck_processing_count integer NOT NULL DEFAULT 0,
  ops_guard_growth_failures_24h integer NOT NULL DEFAULT 0,
  top_issues jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pp_growth_health_snapshots_run_at
  ON public.post_publish_growth_health_snapshots (run_at DESC);

ALTER TABLE public.post_publish_growth_health_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.post_publish_growth_health_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.post_publish_growth_health_snapshots TO service_role;

-- 2) Internal compute helper (no role check) — SSOT
CREATE OR REPLACE FUNCTION public.fn_compute_post_publish_growth_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_blog int; v_og int; v_ix int; v_sm int; v_il int; v_ca int; v_dt int;
  v_stuck_p int; v_stuck_pr int; v_ops int;
  v_status text;
  v_min_cov numeric;
  v_top jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT count(*) INTO v_total FROM public.v_post_publish_growth_coverage;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status','OK','total_published',0,'top_issues','[]'::jsonb);
  END IF;

  SELECT
    count(*) FILTER (WHERE has_blog),
    count(*) FILTER (WHERE has_og_image),
    count(*) FILTER (WHERE has_indexnow),
    count(*) FILTER (WHERE has_sitemap_refresh),
    count(*) FILTER (WHERE has_internal_links),
    count(*) FILTER (WHERE has_campaign_assets),
    count(*) FILTER (WHERE has_distribution_targets)
  INTO v_blog, v_og, v_ix, v_sm, v_il, v_ca, v_dt
  FROM public.v_post_publish_growth_coverage;

  SELECT count(*) INTO v_stuck_p FROM public.job_queue
   WHERE status='pending'
     AND job_type IN ('package_post_publish_blog','seo_indexnow_submit','seo_sitemap_refresh',
                      'seo_internal_links','package_campaign_assets_generate',
                      'package_distribution_plan','package_og_image_generate')
     AND created_at < v_now - interval '30 minutes';

  SELECT count(*) INTO v_stuck_pr FROM public.job_queue
   WHERE status='processing'
     AND job_type IN ('package_post_publish_blog','seo_indexnow_submit','seo_sitemap_refresh',
                      'seo_internal_links','package_campaign_assets_generate',
                      'package_distribution_plan','package_og_image_generate')
     AND COALESCE(started_at, created_at) < v_now - interval '20 minutes';

  SELECT count(*) INTO v_ops FROM public.job_queue
   WHERE job_type IN ('package_post_publish_blog','seo_indexnow_submit','seo_sitemap_refresh',
                      'seo_internal_links','package_campaign_assets_generate',
                      'package_distribution_plan','package_og_image_generate')
     AND last_error ILIKE '%OPS_GUARD:NON_BUILDING_PACKAGE%'
     AND created_at > v_now - interval '24 hours';

  v_min_cov := LEAST(
    (v_blog::numeric*100/v_total),
    (v_og::numeric*100/v_total),
    (v_ix::numeric*100/v_total),
    (v_sm::numeric*100/v_total),
    (v_il::numeric*100/v_total),
    (v_ca::numeric*100/v_total),
    (v_dt::numeric*100/v_total)
  );

  v_status := CASE
    WHEN v_ops > 0 OR v_min_cov < 50 THEN 'CRIT'
    WHEN v_min_cov < 90 OR v_stuck_p > 0 OR v_stuck_pr > 0 THEN 'WARN'
    ELSE 'OK'
  END;

  SELECT jsonb_agg(t) INTO v_top FROM (
    SELECT label, missing_count FROM (
      VALUES
        ('blog',                v_total - v_blog),
        ('og_image',            v_total - v_og),
        ('indexnow',            v_total - v_ix),
        ('sitemap_refresh',     v_total - v_sm),
        ('internal_links',      v_total - v_il),
        ('campaign_assets',     v_total - v_ca),
        ('distribution_targets',v_total - v_dt)
    ) AS s(label, missing_count)
    WHERE missing_count > 0
    ORDER BY missing_count DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'status', v_status,
    'total_published', v_total,
    'coverage_blog_pct',                round((v_blog::numeric*100/v_total),1),
    'coverage_og_image_pct',            round((v_og  ::numeric*100/v_total),1),
    'coverage_indexnow_pct',            round((v_ix  ::numeric*100/v_total),1),
    'coverage_sitemap_pct',             round((v_sm  ::numeric*100/v_total),1),
    'coverage_internal_links_pct',      round((v_il  ::numeric*100/v_total),1),
    'coverage_campaign_assets_pct',     round((v_ca  ::numeric*100/v_total),1),
    'coverage_distribution_pct',        round((v_dt  ::numeric*100/v_total),1),
    'stuck_pending_count', v_stuck_p,
    'stuck_processing_count', v_stuck_pr,
    'ops_guard_growth_failures_24h', v_ops,
    'top_issues', COALESCE(v_top,'[]'::jsonb),
    'last_run_at', (
      SELECT max(created_at) FROM public.auto_heal_log
       WHERE action_type = 'post_publish_growth_health_run'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_compute_post_publish_growth_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_post_publish_growth_health() TO service_role;

-- 3) Refactor admin_get to delegate
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN public.fn_compute_post_publish_growth_health();
END;
$$;

-- 4) Capture function (cron-safe)
CREATE OR REPLACE FUNCTION public.fn_capture_post_publish_growth_health_snapshot()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_health jsonb;
  v_id uuid;
BEGIN
  v_health := public.fn_compute_post_publish_growth_health();

  INSERT INTO public.post_publish_growth_health_snapshots (
    status, total_published,
    coverage_blog_pct, coverage_og_image_pct, coverage_indexnow_pct,
    coverage_sitemap_pct, coverage_internal_links_pct,
    coverage_campaign_assets_pct, coverage_distribution_pct,
    stuck_pending_count, stuck_processing_count,
    ops_guard_growth_failures_24h, top_issues
  )
  VALUES (
    COALESCE(v_health->>'status','OK'),
    COALESCE((v_health->>'total_published')::int, 0),
    COALESCE((v_health->>'coverage_blog_pct')::numeric, 0),
    COALESCE((v_health->>'coverage_og_image_pct')::numeric, 0),
    COALESCE((v_health->>'coverage_indexnow_pct')::numeric, 0),
    COALESCE((v_health->>'coverage_sitemap_pct')::numeric, 0),
    COALESCE((v_health->>'coverage_internal_links_pct')::numeric, 0),
    COALESCE((v_health->>'coverage_campaign_assets_pct')::numeric, 0),
    COALESCE((v_health->>'coverage_distribution_pct')::numeric, 0),
    COALESCE((v_health->>'stuck_pending_count')::int, 0),
    COALESCE((v_health->>'stuck_processing_count')::int, 0),
    COALESCE((v_health->>'ops_guard_growth_failures_24h')::int, 0),
    COALESCE(v_health->'top_issues', '[]'::jsonb)
  )
  RETURNING id INTO v_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'post_publish_growth_health_snapshot',
    'system',
    'success',
    jsonb_build_object('snapshot_id', v_id, 'status', v_health->>'status')
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_capture_post_publish_growth_health_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_capture_post_publish_growth_health_snapshot() TO service_role;

-- 5) Admin trends RPC
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_health_trends(p_days integer DEFAULT 7)
RETURNS TABLE (
  run_at timestamptz,
  status text,
  total_published integer,
  coverage_blog_pct numeric,
  coverage_og_image_pct numeric,
  coverage_indexnow_pct numeric,
  coverage_sitemap_pct numeric,
  coverage_internal_links_pct numeric,
  coverage_campaign_assets_pct numeric,
  coverage_distribution_pct numeric,
  stuck_pending_count integer,
  stuck_processing_count integer,
  ops_guard_growth_failures_24h integer,
  top_issues jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  RETURN QUERY
  SELECT s.run_at, s.status, s.total_published,
         s.coverage_blog_pct, s.coverage_og_image_pct, s.coverage_indexnow_pct,
         s.coverage_sitemap_pct, s.coverage_internal_links_pct,
         s.coverage_campaign_assets_pct, s.coverage_distribution_pct,
         s.stuck_pending_count, s.stuck_processing_count,
         s.ops_guard_growth_failures_24h, s.top_issues
  FROM public.post_publish_growth_health_snapshots s
  WHERE s.run_at > now() - make_interval(days => GREATEST(COALESCE(p_days,7),1))
  ORDER BY s.run_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_publish_growth_health_trends(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_growth_health_trends(integer) TO authenticated;

-- 6) Hourly cron — capture snapshot at minute :07
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job
   WHERE jobname = 'post-publish-growth-health-snapshot-hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'post-publish-growth-health-snapshot-hourly',
    '7 * * * *',
    $cron$ SELECT public.fn_capture_post_publish_growth_health_snapshot(); $cron$
  );
END$$;

-- 7) Initial snapshot so the trend chart isn't empty on first render
SELECT public.fn_capture_post_publish_growth_health_snapshot();