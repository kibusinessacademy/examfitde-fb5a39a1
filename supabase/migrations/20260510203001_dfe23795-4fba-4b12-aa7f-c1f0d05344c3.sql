-- ============================================================
-- Welle 4.2 — Repair-Worker + Bulk-Dispatch
-- ============================================================

-- 1. Detail-RPC: Signale fixen (korrekte Tabellen/Spalten)
CREATE OR REPLACE FUNCTION public.admin_get_growth_quality_package_detail(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_pkg       record;
  v_scores    record;
  v_signals   jsonb;
  v_jobs      jsonb;
  v_heal      jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  SELECT id, title, package_key, curriculum_id, status, published_at
    INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  SELECT * INTO v_scores
  FROM public.v_growth_quality_scores
  WHERE package_id = p_package_id;

  v_signals := jsonb_build_object(
    'blog_articles_count', (
      SELECT count(*) FROM public.blog_articles ba
      WHERE ba.source_package_id = p_package_id
    ),
    'blog_with_og_image', (
      SELECT count(*) FROM public.blog_articles ba
      WHERE ba.source_package_id = p_package_id
        AND COALESCE(ba.og_image_url,'') <> ''
    ),
    'blog_with_inlinks_json', (
      SELECT count(*) FROM public.blog_articles ba
      WHERE ba.source_package_id = p_package_id
        AND jsonb_typeof(ba.internal_links_json) = 'array'
        AND jsonb_array_length(ba.internal_links_json) > 0
    ),
    'campaign_assets_count', (
      SELECT count(*) FROM public.campaign_assets ca
      WHERE ca.curriculum_id = v_pkg.curriculum_id
    ),
    'distribution_targets_count', (
      SELECT count(*) FROM public.distribution_targets dt
      WHERE dt.curriculum_id = v_pkg.curriculum_id
    ),
    'email_sequence_enrollments', (
      SELECT count(*) FROM public.email_delivery_queue edq
      WHERE (edq.metadata->>'package_id') = p_package_id::text
    ),
    'funnel_events_30d', (
      SELECT count(*) FROM public.conversion_events ce
      WHERE ce.package_id = p_package_id
        AND ce.created_at > now() - interval '30 days'
    ),
    'funnel_distinct_event_types_30d', (
      SELECT count(DISTINCT event_type) FROM public.conversion_events ce
      WHERE ce.package_id = p_package_id
        AND ce.created_at > now() - interval '30 days'
    ),
    'cta_events_30d', (
      SELECT count(*) FROM public.conversion_events ce
      WHERE ce.package_id = p_package_id
        AND ce.event_type IN ('cta_visible','cta_click','quiz_cta_clicked','bundle_cta_clicked')
        AND ce.created_at > now() - interval '30 days'
    ),
    'indexnow_completed', EXISTS(
      SELECT 1 FROM public.job_queue
      WHERE package_id = p_package_id AND job_type='seo_indexnow_submit' AND status='completed'
    ),
    'sitemap_refresh_completed', EXISTS(
      SELECT 1 FROM public.job_queue
      WHERE package_id = p_package_id AND job_type='seo_sitemap_refresh' AND status='completed'
    )
  );

  v_jobs := COALESCE((
    SELECT jsonb_agg(j ORDER BY (j->>'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', jq.id, 'job_type', jq.job_type, 'status', jq.status,
        'created_at', jq.created_at, 'completed_at', jq.completed_at,
        'last_error', jq.last_error, 'idempotency_key', jq.idempotency_key,
        'result', jq.result
      ) AS j
      FROM public.job_queue jq
      WHERE jq.package_id = p_package_id
        AND jq.job_type IN (
          'package_post_publish_blog','package_auto_generate_seo_suite','seo_internal_links',
          'package_og_image_generate','package_distribution_plan','package_email_sequence_enroll',
          'growth_quality_repair_cta','growth_quality_repair_funnel_audit',
          'seo_indexnow_submit','seo_sitemap_refresh'
        )
      ORDER BY jq.created_at DESC
      LIMIT 10
    ) t
  ), '[]'::jsonb);

  v_heal := COALESCE((
    SELECT jsonb_agg(h ORDER BY (h->>'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'created_at', a.created_at, 'action_type', a.action_type,
        'result_status', a.result_status, 'result_detail', a.result_detail,
        'metadata', a.metadata
      ) AS h
      FROM public.auto_heal_log a
      WHERE a.target_id = p_package_id::text
        AND (a.action_type IN ('growth_quality_repair_dispatch','growth_quality_repair_worker',
                               'growth_quality_bulk_dispatch')
             OR a.action_type LIKE 'post_publish_growth_repair:%')
      ORDER BY a.created_at DESC
      LIMIT 15
    ) t
  ), '[]'::jsonb);

  RETURN jsonb_build_object(
    'package', jsonb_build_object(
      'id', v_pkg.id, 'title', v_pkg.title, 'package_key', v_pkg.package_key,
      'status', v_pkg.status, 'published_at', v_pkg.published_at,
      'curriculum_id', v_pkg.curriculum_id
    ),
    'scores', CASE WHEN v_scores IS NULL THEN NULL ELSE jsonb_build_object(
      'growth_quality_score', v_scores.growth_quality_score,
      'blog_quality',   v_scores.score_blog_quality,
      'seo_meta',       v_scores.score_seo_meta,
      'internal_links', v_scores.score_internal_links,
      'cta',            v_scores.score_cta,
      'funnel_events',  v_scores.score_funnel_events,
      'email_sequence', v_scores.score_email_sequence,
      'distribution',   v_scores.score_distribution,
      'og_image',       v_scores.score_og_image
    ) END,
    'signals', v_signals,
    'recent_jobs', v_jobs,
    'recent_heal_log', v_heal,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_quality_package_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_quality_package_detail(uuid) TO authenticated;

-- 2. Bulk dispatch RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_bulk_dispatch_growth_quality_repair(
  p_subscore text,
  p_limit    int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_score_col    text;
  v_dispatched   int := 0;
  v_skipped      int := 0;
  v_results      jsonb := '[]'::jsonb;
  r              record;
  v_res          jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  v_score_col := CASE p_subscore
    WHEN 'blog_quality'    THEN 'score_blog_quality'
    WHEN 'seo_meta'        THEN 'score_seo_meta'
    WHEN 'internal_links'  THEN 'score_internal_links'
    WHEN 'cta'             THEN 'score_cta'
    WHEN 'funnel_events'   THEN 'score_funnel_events'
    WHEN 'email_sequence'  THEN 'score_email_sequence'
    WHEN 'distribution'    THEN 'score_distribution'
    WHEN 'og_image'        THEN 'score_og_image'
    ELSE NULL
  END;
  IF v_score_col IS NULL THEN
    RAISE EXCEPTION 'unknown_subscore: %', p_subscore;
  END IF;

  FOR r IN EXECUTE format(
    'SELECT package_id FROM public.v_growth_quality_scores WHERE %I < 50 ORDER BY %I ASC, package_id LIMIT $1',
    v_score_col, v_score_col
  ) USING GREATEST(p_limit,1)
  LOOP
    BEGIN
      v_res := public.admin_dispatch_growth_quality_repair(r.package_id, p_subscore);
      IF v_res->>'status' = 'enqueued' THEN
        v_dispatched := v_dispatched + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      v_results := v_results || jsonb_build_array(v_res || jsonb_build_object('package_id', r.package_id));
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', r.package_id, 'status','error', 'reason', SQLERRM
      ));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_quality_bulk_dispatch', NULL, 'system',
          CASE WHEN v_dispatched > 0 THEN 'enqueued' ELSE 'skipped' END,
          format('subscore=%s dispatched=%s skipped=%s', p_subscore, v_dispatched, v_skipped),
          jsonb_build_object('subscore', p_subscore, 'limit', p_limit,
                             'dispatched', v_dispatched, 'skipped', v_skipped,
                             'actor_uid', v_uid));

  RETURN jsonb_build_object(
    'subscore', p_subscore,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_dispatch_growth_quality_repair(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_dispatch_growth_quality_repair(text, int) TO authenticated;

-- 3. Audit-Funktionen für die zwei neuen Job-Typen (service_role only)
CREATE OR REPLACE FUNCTION public.fn_audit_growth_cta(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH p AS (
    SELECT cp.id, cp.curriculum_id FROM public.course_packages cp WHERE cp.id = p_package_id
  ),
  cta_ev AS (
    SELECT count(*) FILTER (WHERE event_type='cta_visible')      AS visible_30d,
           count(*) FILTER (WHERE event_type='cta_click')        AS click_30d,
           count(*) FILTER (WHERE event_type='quiz_cta_clicked') AS quiz_click_30d
    FROM public.conversion_events
    WHERE package_id = p_package_id AND created_at > now() - interval '30 days'
  ),
  ca AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE asset_type ILIKE '%cta%'
                              OR COALESCE(content_markdown,'') ILIKE '%cta%'
                              OR COALESCE(content_json::text,'') ILIKE '%"cta"%') AS cta_assets
    FROM public.campaign_assets ca, p WHERE ca.curriculum_id = p.curriculum_id
  )
  SELECT jsonb_build_object(
    'package_id', p_package_id,
    'cta_events_30d', jsonb_build_object(
      'visible', cta_ev.visible_30d,
      'click', cta_ev.click_30d,
      'quiz_click', cta_ev.quiz_click_30d
    ),
    'campaign_assets', jsonb_build_object('total', ca.total, 'cta_assets', ca.cta_assets),
    'verdict', CASE
      WHEN cta_ev.visible_30d > 0 AND cta_ev.click_30d > 0 AND ca.cta_assets > 0 THEN 'green'
      WHEN ca.cta_assets > 0 OR cta_ev.visible_30d > 0 THEN 'yellow'
      ELSE 'red'
    END,
    'recommended_action', CASE
      WHEN ca.cta_assets = 0 THEN 'enqueue_campaign_assets_for_curriculum'
      WHEN cta_ev.visible_30d = 0 THEN 'check_landing_page_cta_render'
      WHEN cta_ev.click_30d = 0 THEN 'review_cta_copy_for_engagement'
      ELSE 'monitor'
    END
  )
  FROM cta_ev, ca;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_growth_cta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_growth_cta(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_audit_growth_funnel(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH mandatory AS (
    SELECT unnest(ARRAY[
      'landing_view','quiz_started','lead_capture_submitted',
      'checkout_started','checkout_complete','cta_visible'
    ]) AS event_type
  ),
  observed AS (
    SELECT DISTINCT event_type
    FROM public.conversion_events
    WHERE package_id = p_package_id AND created_at > now() - interval '30 days'
  ),
  diff AS (
    SELECT m.event_type, (o.event_type IS NOT NULL) AS present
    FROM mandatory m LEFT JOIN observed o USING (event_type)
  )
  SELECT jsonb_build_object(
    'package_id', p_package_id,
    'mandatory_event_types', (SELECT jsonb_object_agg(event_type, present) FROM diff),
    'present_count',  (SELECT count(*) FROM diff WHERE present),
    'missing_count',  (SELECT count(*) FROM diff WHERE NOT present),
    'missing',        (SELECT jsonb_agg(event_type ORDER BY event_type) FROM diff WHERE NOT present),
    'verdict', CASE
      WHEN (SELECT count(*) FROM diff WHERE NOT present) = 0 THEN 'green'
      WHEN (SELECT count(*) FROM diff WHERE NOT present) <= 2 THEN 'yellow'
      ELSE 'red'
    END,
    'recommended_action', CASE
      WHEN (SELECT count(*) FROM diff WHERE NOT present) = 0 THEN 'monitor'
      WHEN EXISTS (SELECT 1 FROM diff WHERE NOT present AND event_type IN ('checkout_started','checkout_complete'))
        THEN 'verify_checkout_event_wiring'
      WHEN EXISTS (SELECT 1 FROM diff WHERE NOT present AND event_type IN ('quiz_started','lead_capture_submitted'))
        THEN 'verify_lead_form_wiring'
      ELSE 'review_landing_event_wiring'
    END
  );
$$;

REVOKE ALL ON FUNCTION public.fn_audit_growth_funnel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_growth_funnel(uuid) TO service_role;