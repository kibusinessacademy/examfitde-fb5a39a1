
-- =====================================================================
-- Track 2.3c-0 — Repair Eligibility Projection
-- One row per (package × missing growth signal) with strategy + safety.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_growth_repair_eligibility_v1 AS
WITH gs AS (
  SELECT * FROM public.v_package_growth_signals_v1
),
expanded AS (
  -- Explode the 12 growth signals into one row per missing signal.
  SELECT g.package_id, g.package_key, g.package_title, g.track,
         s.signal, s.is_missing
  FROM gs g
  CROSS JOIN LATERAL (VALUES
    ('seo_present',              NOT g.sig_seo_present),
    ('canonical_ok',             NOT g.sig_canonical_ok),
    ('no_dead_end',              NOT g.sig_no_dead_end),
    ('tracking_pricing_view',    NOT g.sig_tracking_pricing_view),
    ('tracking_checkout_started',NOT g.sig_tracking_checkout_started),
    ('conversion_events',        NOT g.sig_conversion_events_present),
    ('blog',                     NOT g.sig_has_blog),
    ('og_image',                 NOT g.sig_has_og_image),
    ('indexnow',                 NOT g.sig_has_indexnow),
    ('internal_links',           NOT g.sig_has_internal_links),
    ('campaign_assets',          NOT g.sig_has_campaign_assets),
    ('distribution_targets',     NOT g.sig_has_distribution_targets)
  ) s(signal, is_missing)
  WHERE s.is_missing
),
classified AS (
  SELECT
    e.package_id, e.package_key, e.package_title, e.track, e.signal,
    -- root_cause: the underlying class of problem
    CASE e.signal
      WHEN 'seo_present'               THEN 'missing_seo_page'
      WHEN 'canonical_ok'              THEN 'canonical_unresolved'
      WHEN 'no_dead_end'               THEN 'dead_end_links'
      WHEN 'tracking_pricing_view'     THEN 'tracking_not_emitted_pricing'
      WHEN 'tracking_checkout_started' THEN 'tracking_not_emitted_checkout'
      WHEN 'conversion_events'         THEN 'no_events_observed'
      WHEN 'blog'                      THEN 'missing_blog_artifact'
      WHEN 'og_image'                  THEN 'missing_og_image'
      WHEN 'indexnow'                  THEN 'not_submitted_indexnow'
      WHEN 'internal_links'            THEN 'missing_internal_links'
      WHEN 'campaign_assets'           THEN 'missing_campaign_assets'
      WHEN 'distribution_targets'      THEN 'missing_distribution_targets'
    END AS root_cause,
    -- repair_strategy: what action would resolve it
    CASE e.signal
      WHEN 'seo_present'               THEN 'enqueue_seo_page'
      WHEN 'canonical_ok'              THEN 'platform_fix_required'
      WHEN 'no_dead_end'               THEN 'enqueue_link_repair'
      WHEN 'tracking_pricing_view'     THEN 'verify_pixel_wiring'
      WHEN 'tracking_checkout_started' THEN 'verify_pixel_wiring'
      WHEN 'conversion_events'         THEN 'observe_only'
      WHEN 'blog'                      THEN 'enqueue_blog_post'
      WHEN 'og_image'                  THEN 'enqueue_og_image'
      WHEN 'indexnow'                  THEN 'enqueue_indexnow_submit'
      WHEN 'internal_links'            THEN 'enqueue_internal_links'
      WHEN 'campaign_assets'           THEN 'enqueue_campaign_seed'
      WHEN 'distribution_targets'      THEN 'enqueue_distribution_seed'
    END AS repair_strategy,
    -- requires_platform_fix: cannot be solved by a per-package job
    CASE e.signal
      WHEN 'canonical_ok'              THEN true
      WHEN 'tracking_pricing_view'     THEN true   -- pixel wiring is code, not a job
      WHEN 'tracking_checkout_started' THEN true
      WHEN 'conversion_events'         THEN true   -- observability only
      ELSE false
    END AS requires_platform_fix,
    -- expected_job_type for safe dispatch (NULL = no job available)
    CASE e.signal
      WHEN 'seo_present'           THEN 'seo_intent_page_generate'
      WHEN 'no_dead_end'           THEN 'seo_internal_link_repair'
      WHEN 'blog'                  THEN 'growth_blog_post_generate'
      WHEN 'og_image'              THEN 'growth_og_image_generate'
      WHEN 'indexnow'              THEN 'seo_indexnow_submit'
      WHEN 'internal_links'        THEN 'seo_internal_link_seed'
      WHEN 'campaign_assets'       THEN 'growth_campaign_seed'
      WHEN 'distribution_targets'  THEN 'growth_distribution_seed'
      ELSE NULL
    END AS expected_job_type,
    -- expected_artifact: what should exist after repair
    CASE e.signal
      WHEN 'seo_present'           THEN 'seo_content_pages.published'
      WHEN 'no_dead_end'           THEN 'seo_internal_link_suggestions.applied'
      WHEN 'blog'                  THEN 'blog_articles.published'
      WHEN 'og_image'              THEN 'growth_content_graph_nodes.og_image_url'
      WHEN 'indexnow'              THEN 'seo_submission_logs.indexnow_submitted'
      WHEN 'internal_links'        THEN 'seo_internal_link_suggestions'
      WHEN 'campaign_assets'       THEN 'campaign_assets'
      WHEN 'distribution_targets'  THEN 'growth_content_graph_edges.distribution'
      ELSE NULL
    END AS expected_artifact
  FROM expanded e
),
pkg_state AS (
  SELECT cp.id AS package_id,
         cp.status, cp.is_published,
         COALESCE(cp.archived, false) AS archived,
         (cp.product_id IS NOT NULL) AS has_product
  FROM course_packages cp
),
active_jobs AS (
  -- Only jobs that are pending OR processing AND match an expected_job_type
  SELECT DISTINCT ON (jq.package_id, jq.job_type)
         jq.package_id, jq.job_type, jq.id AS job_id, jq.status, jq.created_at
  FROM job_queue jq
  WHERE jq.status IN ('pending','processing','queued')
  ORDER BY jq.package_id, jq.job_type, jq.created_at DESC
)
SELECT
  c.package_id,
  c.package_key,
  c.package_title,
  c.track,
  c.signal,
  c.root_cause,
  c.repair_strategy,
  c.requires_platform_fix,
  c.expected_job_type,
  c.expected_artifact,
  aj.job_id AS active_job_id,
  -- blocked_reason: why this row CANNOT be repaired now (NULL = repairable)
  CASE
    WHEN ps.archived                      THEN 'PACKAGE_ARCHIVED'
    WHEN ps.status IS DISTINCT FROM 'published' THEN 'PACKAGE_NOT_PUBLISHED'
    WHEN NOT COALESCE(ps.is_published,false) THEN 'PACKAGE_NOT_LIVE'
    WHEN NOT ps.has_product               THEN 'PACKAGE_NOT_SELLABLE'
    WHEN c.requires_platform_fix          THEN 'REQUIRES_PLATFORM_FIX'
    WHEN c.expected_job_type IS NULL      THEN 'NO_DISPATCHABLE_JOB_TYPE'
    WHEN aj.job_id IS NOT NULL            THEN 'ACTIVE_JOB_PRESENT'
    ELSE NULL
  END AS blocked_reason,
  -- safe_to_repair: NULL blocked_reason AND has expected_job_type
  (
    NOT ps.archived
    AND ps.status = 'published'
    AND COALESCE(ps.is_published,false)
    AND ps.has_product
    AND NOT c.requires_platform_fix
    AND c.expected_job_type IS NOT NULL
    AND aj.job_id IS NULL
  ) AS safe_to_repair
FROM classified c
LEFT JOIN pkg_state ps ON ps.package_id = c.package_id
LEFT JOIN active_jobs aj
  ON aj.package_id = c.package_id
 AND aj.job_type   = (CASE c.signal
        WHEN 'seo_present'           THEN 'seo_intent_page_generate'
        WHEN 'no_dead_end'           THEN 'seo_internal_link_repair'
        WHEN 'blog'                  THEN 'growth_blog_post_generate'
        WHEN 'og_image'              THEN 'growth_og_image_generate'
        WHEN 'indexnow'              THEN 'seo_indexnow_submit'
        WHEN 'internal_links'        THEN 'seo_internal_link_seed'
        WHEN 'campaign_assets'       THEN 'growth_campaign_seed'
        WHEN 'distribution_targets'  THEN 'growth_distribution_seed'
      END);

REVOKE ALL ON public.v_growth_repair_eligibility_v1 FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_growth_repair_eligibility_v1 TO service_role;

-- ---------------------------------------------------------------------
-- Summary RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_repair_eligibility_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (v_uid IS NOT NULL AND has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'totals', (
      SELECT jsonb_build_object(
        'signals_total',      count(*),
        'safe_to_repair',     count(*) FILTER (WHERE safe_to_repair),
        'blocked',            count(*) FILTER (WHERE NOT safe_to_repair),
        'platform_fix',       count(*) FILTER (WHERE blocked_reason = 'REQUIRES_PLATFORM_FIX'),
        'active_job_present', count(*) FILTER (WHERE blocked_reason = 'ACTIVE_JOB_PRESENT'),
        'packages_touched',   count(DISTINCT package_id)
      )
      FROM v_growth_repair_eligibility_v1
    ),
    'by_strategy', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'repair_strategy', repair_strategy,
        'root_cause',      root_cause,
        'requires_platform_fix', requires_platform_fix,
        'expected_job_type', expected_job_type,
        'signal_count',    cnt,
        'safe_count',      safe_cnt,
        'blocked_count',   cnt - safe_cnt
      ) ORDER BY cnt DESC)
      FROM (
        SELECT repair_strategy, root_cause, requires_platform_fix, expected_job_type,
               count(*) AS cnt,
               count(*) FILTER (WHERE safe_to_repair) AS safe_cnt
        FROM v_growth_repair_eligibility_v1
        GROUP BY 1,2,3,4
      ) s
    ), '[]'::jsonb),
    'by_blocked_reason', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'blocked_reason', COALESCE(blocked_reason, 'REPAIRABLE'),
        'count', cnt
      ) ORDER BY cnt DESC)
      FROM (
        SELECT blocked_reason, count(*) AS cnt
        FROM v_growth_repair_eligibility_v1
        GROUP BY 1
      ) b
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_repair_eligibility_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_repair_eligibility_summary() TO authenticated;

-- ---------------------------------------------------------------------
-- Drill-down RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_repair_eligibility_signals(
  _strategy text DEFAULT NULL,
  _root_cause text DEFAULT NULL,
  _safe_only boolean DEFAULT NULL,
  _blocked_reason text DEFAULT NULL,
  _track text DEFAULT NULL,
  _limit int DEFAULT 200
)
RETURNS TABLE(
  package_id uuid,
  package_key text,
  package_title text,
  track text,
  signal text,
  root_cause text,
  repair_strategy text,
  requires_platform_fix boolean,
  expected_job_type text,
  expected_artifact text,
  active_job_id uuid,
  blocked_reason text,
  safe_to_repair boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (v_uid IS NOT NULL AND has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT v.package_id, v.package_key, v.package_title, v.track,
         v.signal, v.root_cause, v.repair_strategy,
         v.requires_platform_fix, v.expected_job_type, v.expected_artifact,
         v.active_job_id, v.blocked_reason, v.safe_to_repair
  FROM v_growth_repair_eligibility_v1 v
  WHERE (_strategy        IS NULL OR v.repair_strategy = _strategy)
    AND (_root_cause      IS NULL OR v.root_cause      = _root_cause)
    AND (_safe_only       IS NULL OR v.safe_to_repair  = _safe_only)
    AND (_blocked_reason  IS NULL OR v.blocked_reason  = _blocked_reason)
    AND (_track           IS NULL OR v.track           = _track)
  ORDER BY v.safe_to_repair DESC, v.repair_strategy, v.package_key NULLS LAST
  LIMIT GREATEST(_limit, 1);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_repair_eligibility_signals(text,text,boolean,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_repair_eligibility_signals(text,text,boolean,text,text,int) TO authenticated;

-- Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'track_2_3c_0_init',
  'system',
  'ok',
  jsonb_build_object(
    'track','2.3c-0',
    'components', jsonb_build_array(
      'v_growth_repair_eligibility_v1',
      'admin_get_repair_eligibility_summary',
      'admin_get_repair_eligibility_signals'
    )
  )
);
