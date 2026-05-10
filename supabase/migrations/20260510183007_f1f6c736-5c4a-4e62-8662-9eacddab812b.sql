-- 1) Retention cleanup
CREATE OR REPLACE FUNCTION public.fn_cleanup_post_publish_growth_health_snapshots(p_retain_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_retain_days, 90), 7));
BEGIN
  DELETE FROM public.post_publish_growth_health_snapshots WHERE run_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'post_publish_growth_health_snapshot_cleanup',
    'system',
    CASE WHEN v_deleted > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object('deleted', v_deleted, 'retain_days', p_retain_days, 'cutoff', v_cutoff)
  );

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cleanup_post_publish_growth_health_snapshots(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cleanup_post_publish_growth_health_snapshots(integer) TO service_role;

-- 2) Daily cron — retention 90d at 03:23 UTC
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job
   WHERE jobname = 'post-publish-growth-health-snapshot-cleanup-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

  PERFORM cron.schedule(
    'post-publish-growth-health-snapshot-cleanup-daily',
    '23 3 * * *',
    $cron$ SELECT public.fn_cleanup_post_publish_growth_health_snapshots(90); $cron$
  );
END$$;

-- 3) Drilldown RPC — single snapshot detail
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_health_snapshot_detail(p_snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.post_publish_growth_health_snapshots;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT * INTO v_row FROM public.post_publish_growth_health_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_publish_growth_health_snapshot_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_growth_health_snapshot_detail(uuid) TO authenticated;

-- 4) Drop & recreate trends RPC with id column
DROP FUNCTION IF EXISTS public.admin_get_post_publish_growth_health_trends(integer);

CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_health_trends(p_days integer DEFAULT 7)
RETURNS TABLE (
  id uuid,
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
  SELECT s.id, s.run_at, s.status, s.total_published,
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

-- 5) Smoke retention dry run (should be 0)
SELECT public.fn_cleanup_post_publish_growth_health_snapshots(90) AS deleted_smoke;