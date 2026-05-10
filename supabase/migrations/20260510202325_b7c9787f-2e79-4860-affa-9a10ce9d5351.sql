-- ============================================================
-- Welle 4.1 Growth Quality Repair Workflow
-- ============================================================

-- 1. Register new job types (CTA + Funnel audit haben keinen bestehenden Worker)
INSERT INTO public.ops_job_type_registry (job_type, lane, requires_package_id, is_governance)
VALUES
  ('growth_quality_repair_cta',          'marketing', true, false),
  ('growth_quality_repair_funnel_audit', 'marketing', true, false)
ON CONFLICT (job_type) DO NOTHING;

-- 2. Dispatch RPC ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dispatch_growth_quality_repair(
  p_package_id uuid,
  p_subscore   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_job_type      text;
  v_idem          text;
  v_now           timestamptz := now();
  v_existing_id   uuid;
  v_inserted_id   uuid;
  v_curriculum_id uuid;
  v_status        text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'package_id_required';
  END IF;

  v_job_type := CASE p_subscore
    WHEN 'blog_quality'    THEN 'package_post_publish_blog'
    WHEN 'seo_meta'        THEN 'package_auto_generate_seo_suite'
    WHEN 'internal_links'  THEN 'seo_internal_links'
    WHEN 'cta'             THEN 'growth_quality_repair_cta'
    WHEN 'funnel_events'   THEN 'growth_quality_repair_funnel_audit'
    WHEN 'email_sequence'  THEN 'package_email_sequence_enroll'
    WHEN 'distribution'    THEN 'package_distribution_plan'
    WHEN 'og_image'        THEN 'package_og_image_generate'
    ELSE NULL
  END;

  IF v_job_type IS NULL THEN
    RAISE EXCEPTION 'unknown_subscore: %', p_subscore;
  END IF;

  SELECT curriculum_id, status
    INTO v_curriculum_id, v_status
  FROM public.course_packages
  WHERE id = p_package_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'package_not_published (status=%)', v_status;
  END IF;

  v_idem := 'growth_quality_repair:'||p_subscore||':'||p_package_id::text||':'||to_char(v_now,'YYYYMMDDHH24');

  SELECT id INTO v_existing_id
  FROM public.job_queue
  WHERE idempotency_key = v_idem
    AND status IN ('pending','processing');

  IF v_existing_id IS NOT NULL THEN
    INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('growth_quality_repair_dispatch', p_package_id::text, 'package',
            'skipped', 'idempotency_active',
            jsonb_build_object('subscore', p_subscore, 'job_type', v_job_type,
                               'idempotency_key', v_idem, 'existing_job_id', v_existing_id,
                               'actor_uid', v_uid));
    RETURN jsonb_build_object('status','skipped','reason','idempotency_active',
                              'job_id', v_existing_id, 'subscore', p_subscore, 'job_type', v_job_type);
  END IF;

  INSERT INTO public.job_queue(job_type, status, payload, package_id, lane, worker_pool,
                               idempotency_key, job_name, priority)
  VALUES (v_job_type, 'pending',
          jsonb_build_object(
            'package_id',    p_package_id,
            'curriculum_id', v_curriculum_id,
            'subscore',      p_subscore,
            'origin',        'growth_quality_repair',
            'actor_uid',     v_uid
          ),
          p_package_id, 'marketing', 'core',
          v_idem,
          'growth_quality_repair:'||p_subscore,
          5)
  RETURNING id INTO v_inserted_id;

  INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_quality_repair_dispatch', p_package_id::text, 'package',
          'enqueued', v_job_type,
          jsonb_build_object('subscore', p_subscore, 'job_type', v_job_type,
                             'job_id', v_inserted_id, 'idempotency_key', v_idem,
                             'actor_uid', v_uid));

  RETURN jsonb_build_object('status','enqueued','job_id', v_inserted_id,
                            'subscore', p_subscore, 'job_type', v_job_type,
                            'idempotency_key', v_idem);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_growth_quality_repair(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_growth_quality_repair(uuid, text) TO authenticated;

-- 3. Detail RPC -----------------------------------------------------------
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

  -- Roh-Signale (best-effort; tolerant gegen Schema-Varianten)
  v_signals := jsonb_build_object(
    'blog_articles_count', (
      SELECT count(*) FROM public.blog_articles ba
      WHERE ba.package_id = p_package_id OR ba.curriculum_id = v_pkg.curriculum_id
    ),
    'og_image_url', (
      SELECT og_image_url FROM public.course_packages WHERE id = p_package_id
    ),
    'internal_links_count', (
      SELECT count(*) FROM public.seo_internal_links sil
      WHERE sil.from_package_id = p_package_id OR sil.to_package_id = p_package_id
    ),
    'distribution_targets_count', (
      SELECT count(*) FROM public.campaign_assets ca
      WHERE ca.package_id = p_package_id
    ),
    'email_sequence_enrollments', (
      SELECT count(*) FROM public.email_delivery_queue edq
      WHERE (edq.metadata->>'package_id')::text = p_package_id::text
    ),
    'funnel_events_30d', (
      SELECT count(*) FROM public.conversion_events ce
      WHERE ce.package_id = p_package_id
        AND ce.created_at > now() - interval '30 days'
    )
  );

  -- Letzte 10 Repair-/Growth-Jobs für dieses Paket
  v_jobs := COALESCE((
    SELECT jsonb_agg(j ORDER BY (j->>'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', jq.id,
        'job_type', jq.job_type,
        'status', jq.status,
        'created_at', jq.created_at,
        'completed_at', jq.completed_at,
        'last_error', jq.last_error,
        'idempotency_key', jq.idempotency_key
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
        'created_at', a.created_at,
        'action_type', a.action_type,
        'result_status', a.result_status,
        'result_detail', a.result_detail,
        'metadata', a.metadata
      ) AS h
      FROM public.auto_heal_log a
      WHERE a.target_id = p_package_id::text
        AND (a.action_type = 'growth_quality_repair_dispatch'
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
EXCEPTION WHEN undefined_table OR undefined_column THEN
  -- Tolerant gegen Schema-Drift in seo_internal_links/email_delivery_queue/campaign_assets
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
    'signals', jsonb_build_object('error','partial_signals_unavailable'),
    'recent_jobs', '[]'::jsonb,
    'recent_heal_log', '[]'::jsonb,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_quality_package_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_quality_package_detail(uuid) TO authenticated;