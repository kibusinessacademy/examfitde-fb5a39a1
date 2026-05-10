
CREATE INDEX IF NOT EXISTS idx_auto_heal_log_growth_repair
  ON public.auto_heal_log (action_type, target_id, created_at DESC)
  WHERE action_type LIKE 'post_publish_growth_repair:%';

CREATE OR REPLACE FUNCTION public.fn_run_post_publish_growth_health_check(
  p_repair  boolean DEFAULT false,
  p_limit   int     DEFAULT 25,
  p_job_type text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cooldown_minutes int := 30;
  v_repaired         int := 0;
  v_skipped_cooldown int := 0;
  v_skipped_whitelist int := 0;
  v_drift_total      int := 0;
  v_now              timestamptz := now();
  v_artifact_jobs    text[] := ARRAY[
    'package_post_publish_blog',
    'seo_indexnow_submit',
    'seo_sitemap_refresh',
    'seo_internal_links',
    'package_campaign_assets_generate',
    'package_distribution_plan',
    'package_og_image_generate'
  ];
  v_stuck_pending    int;
  v_stuck_processing int;
  v_ops_guard_24h    int;
  r                  record;
  v_idem             text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _growth_drift_tmp ON COMMIT DROP AS
  SELECT cov.package_id, cov.curriculum_id, jt.job_type
  FROM public.v_post_publish_growth_coverage cov
  CROSS JOIN unnest(v_artifact_jobs) AS jt(job_type)
  WHERE
    (jt.job_type = 'package_post_publish_blog'        AND cov.has_blog                  = false) OR
    (jt.job_type = 'seo_indexnow_submit'              AND cov.has_indexnow              = false) OR
    (jt.job_type = 'seo_sitemap_refresh'              AND cov.has_sitemap_refresh       = false) OR
    (jt.job_type = 'seo_internal_links'               AND cov.has_internal_links        = false) OR
    (jt.job_type = 'package_campaign_assets_generate' AND cov.has_campaign_assets       = false) OR
    (jt.job_type = 'package_distribution_plan'        AND cov.has_distribution_targets  = false) OR
    (jt.job_type = 'package_og_image_generate'        AND cov.has_og_image              = false);

  SELECT count(*) INTO v_drift_total FROM _growth_drift_tmp
   WHERE p_job_type IS NULL OR job_type = p_job_type;

  IF p_repair THEN
    FOR r IN
      SELECT d.package_id, d.curriculum_id, d.job_type
      FROM _growth_drift_tmp d
      WHERE (p_job_type IS NULL OR d.job_type = p_job_type)
        AND NOT EXISTS (
          SELECT 1 FROM public.auto_heal_log a
          WHERE a.action_type = 'post_publish_growth_repair:'||d.job_type
            AND a.target_id   = d.package_id::text
            AND a.created_at  > v_now - make_interval(mins => v_cooldown_minutes)
        )
      ORDER BY d.package_id
      LIMIT GREATEST(p_limit, 1)
    LOOP
      IF NOT public.fn_is_job_type_whitelisted_for_non_building_package(r.job_type) THEN
        v_skipped_whitelist := v_skipped_whitelist + 1;
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
        VALUES ('post_publish_growth_repair:'||r.job_type, r.package_id::text, 'package',
                'skipped', 'whitelist_missing',
                jsonb_build_object('job_type', r.job_type));
        CONTINUE;
      END IF;

      v_idem := 'growth_repair:'||r.job_type||':'||r.package_id::text||':'||to_char(v_now,'YYYYMMDDHH24');

      BEGIN
        INSERT INTO public.job_queue (
          job_type, package_id, status, idempotency_key, meta, created_at
        ) VALUES (
          r.job_type, r.package_id, 'pending', v_idem,
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
        VALUES ('post_publish_growth_repair:'||r.job_type, r.package_id::text, 'package',
                'enqueued', 'repair_job_created',
                jsonb_build_object('job_type', r.job_type, 'idempotency_key', v_idem, 'curriculum_id', r.curriculum_id));
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, error_message, metadata)
        VALUES ('post_publish_growth_repair:'||r.job_type, r.package_id::text, 'package',
                'failed', SQLERRM,
                jsonb_build_object('job_type', r.job_type));
      END;
    END LOOP;

    SELECT count(*) INTO v_skipped_cooldown
    FROM _growth_drift_tmp d
    WHERE (p_job_type IS NULL OR d.job_type = p_job_type)
      AND EXISTS (
        SELECT 1 FROM public.auto_heal_log a
        WHERE a.action_type = 'post_publish_growth_repair:'||d.job_type
          AND a.target_id   = d.package_id::text
          AND a.created_at  > v_now - make_interval(mins => v_cooldown_minutes)
      );
  END IF;

  SELECT count(*) INTO v_stuck_pending FROM public.job_queue
   WHERE status='pending' AND job_type = ANY(v_artifact_jobs)
     AND created_at < v_now - interval '30 minutes';

  SELECT count(*) INTO v_stuck_processing FROM public.job_queue
   WHERE status='processing' AND job_type = ANY(v_artifact_jobs)
     AND COALESCE(started_at, created_at) < v_now - interval '20 minutes';

  SELECT count(*) INTO v_ops_guard_24h FROM public.job_queue
   WHERE job_type = ANY(v_artifact_jobs)
     AND last_error ILIKE '%OPS_GUARD%'
     AND updated_at > v_now - interval '24 hours';

  INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES (
    'post_publish_growth_health_check',
    'system','system',
    CASE WHEN v_repaired > 0 THEN 'repaired' WHEN v_drift_total > 0 THEN 'drift_detected' ELSE 'ok' END,
    'fn_run_post_publish_growth_health_check',
    jsonb_build_object(
      'repair_mode', p_repair,
      'p_limit', p_limit,
      'p_job_type', p_job_type,
      'drift_total', v_drift_total,
      'repaired', v_repaired,
      'skipped_cooldown', v_skipped_cooldown,
      'skipped_whitelist', v_skipped_whitelist,
      'stuck_pending', v_stuck_pending,
      'stuck_processing', v_stuck_processing,
      'ops_guard_24h', v_ops_guard_24h
    )
  );

  RETURN jsonb_build_object(
    'repair_mode', p_repair,
    'p_limit', p_limit,
    'p_job_type', p_job_type,
    'drift_total', v_drift_total,
    'repaired', v_repaired,
    'skipped_cooldown', v_skipped_cooldown,
    'skipped_whitelist', v_skipped_whitelist,
    'stuck_pending', v_stuck_pending,
    'stuck_processing', v_stuck_processing,
    'ops_guard_24h', v_ops_guard_24h,
    'ran_at', v_now
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_run_post_publish_growth_repair(
  p_repair  boolean DEFAULT true,
  p_limit   int     DEFAULT 25,
  p_job_type text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public.fn_run_post_publish_growth_health_check(p_repair, p_limit, p_job_type);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_post_publish_growth_repair(boolean,int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_post_publish_growth_repair(boolean,int,text) TO authenticated;
