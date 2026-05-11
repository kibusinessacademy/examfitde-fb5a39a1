
-- 1) Cancel pending/processing seo_sitemap_refresh jobs (no functional handler exists)
WITH cancelled AS (
  UPDATE public.job_queue
  SET status = 'cancelled',
      completed_at = now(),
      updated_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = 'CANCELLED_NO_PER_PACKAGE_HANDLER: seo_sitemap_refresh has no per-package worker (sitemap is global)',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancelled_reason','no_handler','cancelled_at',now())
  WHERE job_type = 'seo_sitemap_refresh'
    AND status IN ('pending','processing')
  RETURNING id
)
INSERT INTO public.auto_heal_log (action_type, result_status, result_detail, metadata)
SELECT 'sitemap_refresh_cancel_no_handler', 'success',
       'Cancelled per-package seo_sitemap_refresh — no handler implementation exists',
       jsonb_build_object('cancelled_count', (SELECT COUNT(*) FROM cancelled))
;

-- 2) Patch the post-publish growth health-check producer to drop seo_sitemap_refresh
--    from its drift-detection list. The artifact-coverage view still tracks it,
--    but no new repair jobs will be enqueued for that type until a real handler exists.
CREATE OR REPLACE FUNCTION public.fn_run_post_publish_growth_health_check(
  p_repair boolean DEFAULT false,
  p_limit integer DEFAULT 25,
  p_job_type text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cooldown_minutes  int := 30;
  v_repaired          int := 0;
  v_skipped_cooldown  int := 0;
  v_skipped_whitelist int := 0;
  v_skipped_dup       int := 0;
  v_drift_total       int := 0;
  v_now               timestamptz := now();
  -- NOTE: 'seo_sitemap_refresh' intentionally REMOVED — no per-package handler exists
  --       (handler used to be the public XML endpoint generate-sitemap, which always
  --       returned EMPTY_RESULT in the runner). Producer would loop forever.
  v_artifact_jobs     text[] := ARRAY[
    'package_post_publish_blog','seo_indexnow_submit','seo_internal_links',
    'package_campaign_assets_generate','package_distribution_plan','package_og_image_generate'
  ];
  v_stuck_pending     int;
  v_stuck_processing  int;
  v_ops_guard_24h     int;
  r                   record;
  v_idem              text;
  v_payload           jsonb;
  v_inserted_id       uuid;
BEGIN
  SELECT count(*) INTO v_drift_total
  FROM public.v_post_publish_growth_coverage cov
  CROSS JOIN unnest(v_artifact_jobs) AS jt(job_type)
  WHERE (p_job_type IS NULL OR jt.job_type = p_job_type)
    AND (
      (jt.job_type = 'package_post_publish_blog'        AND cov.has_blog                  = false) OR
      (jt.job_type = 'seo_indexnow_submit'              AND cov.has_indexnow              = false) OR
      (jt.job_type = 'seo_internal_links'               AND cov.has_internal_links        = false) OR
      (jt.job_type = 'package_campaign_assets_generate' AND cov.has_campaign_assets       = false) OR
      (jt.job_type = 'package_distribution_plan'        AND cov.has_distribution_targets  = false) OR
      (jt.job_type = 'package_og_image_generate'        AND cov.has_og_image              = false)
    );

  IF p_repair THEN
    FOR r IN
      WITH drift AS (
        SELECT cov.package_id, cov.curriculum_id, jt.job_type
        FROM public.v_post_publish_growth_coverage cov
        CROSS JOIN unnest(v_artifact_jobs) AS jt(job_type)
        WHERE (p_job_type IS NULL OR jt.job_type = p_job_type)
          AND (
            (jt.job_type = 'package_post_publish_blog'        AND cov.has_blog                  = false) OR
            (jt.job_type = 'seo_indexnow_submit'              AND cov.has_indexnow              = false) OR
            (jt.job_type = 'seo_internal_links'               AND cov.has_internal_links        = false) OR
            (jt.job_type = 'package_campaign_assets_generate' AND cov.has_campaign_assets       = false) OR
            (jt.job_type = 'package_distribution_plan'        AND cov.has_distribution_targets  = false) OR
            (jt.job_type = 'package_og_image_generate'        AND cov.has_og_image              = false)
          )
      )
      SELECT d.package_id, d.curriculum_id, d.job_type
      FROM drift d
      WHERE NOT EXISTS (
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
                'skipped', 'whitelist_missing', jsonb_build_object('job_type', r.job_type));
        CONTINUE;
      END IF;

      v_idem := 'growth_repair:'||r.job_type||':'||r.package_id::text||':'||to_char(v_now,'YYYYMMDDHH24');

      IF EXISTS (
        SELECT 1 FROM public.job_queue
        WHERE idempotency_key = v_idem AND status IN ('pending','processing')
      ) THEN
        v_skipped_dup := v_skipped_dup + 1;
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
        VALUES ('post_publish_growth_repair:'||r.job_type, r.package_id::text, 'package',
                'skipped', 'idempotency_active',
                jsonb_build_object('job_type', r.job_type, 'idempotency_key', v_idem));
        CONTINUE;
      END IF;

      v_payload := jsonb_build_object(
        'package_id', r.package_id,
        'curriculum_id', r.curriculum_id,
        'step_key', 'post_publish_growth',
        'enqueue_source', 'post_publish_growth_self_heal',
        'detector_run_at', v_now
      );

      INSERT INTO public.job_queue (
        job_type, status, package_id, curriculum_id, payload,
        priority, lane, worker_pool, idempotency_key, created_at, run_after
      ) VALUES (
        r.job_type, 'pending', r.package_id, r.curriculum_id, v_payload,
        50, public.derive_job_lane(r.job_type), 'default', v_idem, v_now, v_now
      ) RETURNING id INTO v_inserted_id;

      v_repaired := v_repaired + 1;
      INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('post_publish_growth_repair:'||r.job_type, r.package_id::text, 'package',
              'enqueued', 'self-heal job enqueued',
              jsonb_build_object('job_type', r.job_type, 'job_id', v_inserted_id, 'idempotency_key', v_idem));
    END LOOP;
  END IF;

  SELECT count(*) INTO v_stuck_pending
  FROM public.job_queue
  WHERE job_type = ANY(v_artifact_jobs) AND status = 'pending';

  SELECT count(*) INTO v_stuck_processing
  FROM public.job_queue
  WHERE job_type = ANY(v_artifact_jobs) AND status = 'processing';

  SELECT count(*) INTO v_ops_guard_24h
  FROM public.auto_heal_log
  WHERE action_type LIKE 'post_publish_growth_repair:%'
    AND result_status = 'skipped'
    AND result_detail = 'whitelist_missing'
    AND created_at > v_now - interval '24 hours';

  INSERT INTO public.auto_heal_log(action_type, result_status, result_detail, metadata)
  VALUES (
    'post_publish_growth_health_check', 'repaired',
    format('drift=%s repaired=%s', v_drift_total, v_repaired),
    jsonb_build_object(
      'drift_total', v_drift_total,
      'repaired', v_repaired,
      'skipped_cooldown', v_skipped_cooldown,
      'skipped_whitelist', v_skipped_whitelist,
      'skipped_dup', v_skipped_dup,
      'stuck_pending', v_stuck_pending,
      'stuck_processing', v_stuck_processing,
      'ops_guard_24h', v_ops_guard_24h
    )
  );

  RETURN jsonb_build_object(
    'drift_total', v_drift_total,
    'repaired', v_repaired,
    'skipped_cooldown', v_skipped_cooldown,
    'skipped_whitelist', v_skipped_whitelist,
    'skipped_dup', v_skipped_dup,
    'stuck_pending', v_stuck_pending,
    'stuck_processing', v_stuck_processing,
    'ops_guard_24h', v_ops_guard_24h
  );
END;
$function$;

-- 3) Audit
INSERT INTO public.auto_heal_log (action_type, result_status, result_detail, metadata)
VALUES (
  'sitemap_refresh_producer_disabled',
  'success',
  'Removed seo_sitemap_refresh from post-publish growth drift list — no per-package handler implemented',
  jsonb_build_object('reason','EMPTY_RESULT loop','rollback_hint','re-add to v_artifact_jobs once a real handler exists')
);
