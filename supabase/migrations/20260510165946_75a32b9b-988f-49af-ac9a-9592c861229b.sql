
-- ============================================================================
-- WELLE 3: Post-Publish Growth Self-Heal + Health
-- ============================================================================

-- 1) Coverage view per published package
CREATE OR REPLACE VIEW public.v_post_publish_growth_coverage AS
WITH pkgs AS (
  SELECT id AS package_id, curriculum_id, title, package_key, feature_flags, published_at
  FROM public.course_packages
  WHERE status = 'published'
),
blog AS (
  SELECT DISTINCT source_package_id AS package_id FROM public.blog_articles
  WHERE source_package_id IS NOT NULL AND status IN ('published','generated','draft')
),
camp_assets AS (
  SELECT curriculum_id, count(*) AS n FROM public.campaign_assets
  WHERE curriculum_id IS NOT NULL GROUP BY curriculum_id
),
dist AS (
  SELECT curriculum_id, count(*) AS n FROM public.distribution_targets
  WHERE curriculum_id IS NOT NULL GROUP BY curriculum_id
),
ix AS (
  SELECT package_id FROM (
    SELECT DISTINCT package_id FROM public.job_queue
    WHERE job_type = 'seo_indexnow_submit' AND status = 'completed' AND package_id IS NOT NULL
  ) s
),
sm AS (
  SELECT DISTINCT package_id FROM public.job_queue
  WHERE job_type = 'seo_sitemap_refresh' AND status = 'completed' AND package_id IS NOT NULL
),
il AS (
  SELECT DISTINCT package_id FROM public.job_queue
  WHERE job_type = 'seo_internal_links' AND status = 'completed' AND package_id IS NOT NULL
)
SELECT
  p.package_id,
  p.curriculum_id,
  p.title,
  p.package_key,
  p.published_at,
  (b.package_id IS NOT NULL)                            AS has_blog,
  (NULLIF(p.feature_flags->>'og_image_url','') IS NOT NULL) AS has_og_image,
  (ix.package_id IS NOT NULL)                           AS has_indexnow,
  (sm.package_id IS NOT NULL)                           AS has_sitemap_refresh,
  (il.package_id IS NOT NULL)                           AS has_internal_links,
  COALESCE(ca.n,0)                                      AS campaign_assets_count,
  COALESCE(dt.n,0)                                      AS distribution_targets_count,
  (COALESCE(ca.n,0) > 0)                                AS has_campaign_assets,
  (COALESCE(dt.n,0) > 0)                                AS has_distribution_targets
FROM pkgs p
LEFT JOIN blog       b  ON b.package_id  = p.package_id
LEFT JOIN ix             ON ix.package_id = p.package_id
LEFT JOIN sm             ON sm.package_id = p.package_id
LEFT JOIN il             ON il.package_id = p.package_id
LEFT JOIN camp_assets ca ON ca.curriculum_id = p.curriculum_id
LEFT JOIN dist        dt ON dt.curriculum_id = p.curriculum_id;

REVOKE ALL ON public.v_post_publish_growth_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_post_publish_growth_coverage TO service_role;

-- 2) Detector + repair central function
CREATE OR REPLACE FUNCTION public.fn_run_post_publish_growth_health_check(p_repair boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repair_cap        int := 25;
  v_cooldown_minutes  int := 30;
  v_repaired          int := 0;
  v_skipped_cooldown  int := 0;
  v_drift_detected    int := 0;
  r                   record;
  v_jt                text;
  v_idem              text;
  v_now               timestamptz := now();
  v_artifact_jobs     text[] := ARRAY[
    'package_post_publish_blog',
    'seo_indexnow_submit',
    'seo_sitemap_refresh',
    'seo_internal_links',
    'package_campaign_assets_generate',
    'package_distribution_plan',
    'package_og_image_generate'
  ];
  v_stuck_pending     int;
  v_stuck_processing  int;
  v_ops_guard_24h     int;
  v_summary           jsonb;
BEGIN
  -- Iterate published packages × growth job_types and detect missing artifact
  FOR r IN
    SELECT cov.package_id, cov.curriculum_id, jt.job_type, cov.*
    FROM public.v_post_publish_growth_coverage cov
    CROSS JOIN unnest(v_artifact_jobs) AS jt(job_type)
    WHERE
      (jt.job_type = 'package_post_publish_blog'        AND cov.has_blog                  = false) OR
      (jt.job_type = 'seo_indexnow_submit'              AND cov.has_indexnow              = false) OR
      (jt.job_type = 'seo_sitemap_refresh'              AND cov.has_sitemap_refresh       = false) OR
      (jt.job_type = 'seo_internal_links'               AND cov.has_internal_links        = false) OR
      (jt.job_type = 'package_campaign_assets_generate' AND cov.has_campaign_assets       = false) OR
      (jt.job_type = 'package_distribution_plan'        AND cov.has_distribution_targets  = false) OR
      (jt.job_type = 'package_og_image_generate'        AND cov.has_og_image              = false)
  LOOP
    v_drift_detected := v_drift_detected + 1;
    v_jt := r.job_type;

    EXIT WHEN p_repair AND v_repaired >= v_repair_cap;
    CONTINUE WHEN NOT p_repair;

    -- Cooldown: skip if we already enqueued/audited a repair for this (pkg, job_type) within last 30min
    IF EXISTS (
      SELECT 1 FROM public.auto_heal_log
      WHERE action_type = 'post_publish_growth_repair:'||v_jt
        AND target_id   = r.package_id::text
        AND created_at  > v_now - make_interval(mins => v_cooldown_minutes)
    ) THEN
      v_skipped_cooldown := v_skipped_cooldown + 1;
      CONTINUE;
    END IF;

    -- Whitelist guard
    IF NOT public.fn_is_job_type_whitelisted_for_non_building_package(v_jt) THEN
      INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('post_publish_growth_repair:'||v_jt, r.package_id::text, 'package',
              'skipped', 'whitelist_missing',
              jsonb_build_object('job_type', v_jt));
      CONTINUE;
    END IF;

    v_idem := 'growth_repair:'||v_jt||':'||r.package_id::text||':'||to_char(v_now,'YYYYMMDDHH24');

    BEGIN
      INSERT INTO public.job_queue (
        job_type, package_id, status, idempotency_key, meta, created_at
      ) VALUES (
        v_jt, r.package_id, 'pending', v_idem,
        jsonb_build_object(
          'enqueue_source', 'post_publish_growth_self_heal',
          'curriculum_id', r.curriculum_id,
          'detector_run_at', v_now
        ),
        v_now
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      v_repaired := v_repaired + 1;

      INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('post_publish_growth_repair:'||v_jt, r.package_id::text, 'package',
              'enqueued', 'repair_job_created',
              jsonb_build_object('job_type', v_jt, 'idempotency_key', v_idem, 'curriculum_id', r.curriculum_id));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, error_message, metadata)
      VALUES ('post_publish_growth_repair:'||v_jt, r.package_id::text, 'package',
              'failed', SQLERRM,
              jsonb_build_object('job_type', v_jt));
    END;
  END LOOP;

  -- Stuck job detectors
  SELECT count(*) INTO v_stuck_pending FROM public.job_queue
   WHERE status='pending' AND job_type = ANY(v_artifact_jobs)
     AND created_at < v_now - interval '30 minutes';

  SELECT count(*) INTO v_stuck_processing FROM public.job_queue
   WHERE status='processing' AND job_type = ANY(v_artifact_jobs)
     AND COALESCE(started_at, created_at) < v_now - interval '20 minutes';

  SELECT count(*) INTO v_ops_guard_24h FROM public.job_queue
   WHERE job_type = ANY(v_artifact_jobs)
     AND last_error ILIKE '%OPS_GUARD:NON_BUILDING_PACKAGE%'
     AND created_at > v_now - interval '24 hours';

  v_summary := jsonb_build_object(
    'run_at', v_now,
    'mode', CASE WHEN p_repair THEN 'repair' ELSE 'detect' END,
    'drift_detected', v_drift_detected,
    'repaired', v_repaired,
    'skipped_cooldown', v_skipped_cooldown,
    'stuck_pending_count', v_stuck_pending,
    'stuck_processing_count', v_stuck_processing,
    'ops_guard_growth_failures_24h', v_ops_guard_24h
  );

  INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('post_publish_growth_health_run', 'system', 'system',
          CASE WHEN v_drift_detected = 0 THEN 'ok'
               WHEN p_repair AND v_repaired > 0 THEN 'repaired'
               ELSE 'drift_detected' END,
          'detector_run',
          v_summary);

  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_run_post_publish_growth_health_check(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_post_publish_growth_health_check(boolean) TO service_role;

-- 3) Admin Health RPC
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_health()
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

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

REVOKE ALL ON FUNCTION public.admin_get_post_publish_growth_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_growth_health() TO authenticated, service_role;

-- 4) Admin manual repair RPC
CREATE OR REPLACE FUNCTION public.admin_run_post_publish_growth_repair(p_repair boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  v_res := public.fn_run_post_publish_growth_health_check(p_repair);
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_post_publish_growth_repair(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_post_publish_growth_repair(boolean) TO authenticated, service_role;

-- 5) Cron 15min (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('post-publish-growth-health-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'post-publish-growth-health-15min',
  '*/15 * * * *',
  $cron$ SELECT public.fn_run_post_publish_growth_health_check(true); $cron$
);
