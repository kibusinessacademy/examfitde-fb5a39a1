CREATE OR REPLACE VIEW public.v_package_operational_state_v1 AS
WITH base AS (
  SELECT
    cp.id AS package_id, cp.package_key, cp.title AS package_title,
    cp.track::text AS track, cp.status AS package_status,
    cp.curriculum_id, cp.product_id, cp.build_progress, cp.current_step,
    cp.blocked_reason, cp.locked_at, cp.council_approved, cp.integrity_passed,
    CASE
      WHEN cp.feature_flags ? 'bronze'
        AND jsonb_typeof(cp.feature_flags->'bronze') = 'object'
        AND COALESCE((cp.feature_flags->'bronze'->>'repair_active')::boolean, true)
        AND NOT COALESCE((cp.feature_flags->'bronze'->>'manual_bypass')::boolean, false)
      THEN true
      WHEN cp.feature_flags ? 'bronze'
        AND jsonb_typeof(cp.feature_flags->'bronze') = 'boolean'
      THEN (cp.feature_flags->>'bronze')::boolean
      ELSE false
    END AS bronze_locked,
    cp.is_published, cp.published_at, cp.last_error
  FROM public.course_packages cp
  WHERE COALESCE(cp.archived, false) = false
),
cs AS (
  SELECT package_id, customer_safe, sellable, delivery_ready, entitlement_ready,
         tutor_ready, exam_pool_ready, commerce_gate_state, post_publish_state,
         missing_dimensions, gap_class, sub_flags
  FROM public.v_package_customer_safe_v1
),
g AS (
  SELECT package_id, has_blog, has_og_image, has_indexnow, has_internal_links,
         has_campaign_assets, has_distribution_targets,
         ( (CASE WHEN has_blog THEN 1 ELSE 0 END)
         + (CASE WHEN has_og_image THEN 1 ELSE 0 END)
         + (CASE WHEN has_indexnow THEN 1 ELSE 0 END)
         + (CASE WHEN has_internal_links THEN 1 ELSE 0 END) )::int AS seo_signal_count
  FROM public.v_post_publish_growth_coverage
),
b AS (
  SELECT id AS product_id,
         COALESCE((channel_policy_json->'b2b'->>'enabled')::boolean, false) AS b2b_enabled,
         NULLIF(channel_policy_json->'b2b'->>'seat_min','')::int AS b2b_seat_min,
         NULLIF(channel_policy_json->'b2b'->>'seat_max','')::int AS b2b_seat_max
  FROM public.products
)
SELECT
  base.package_id, base.package_key, base.package_title, base.track,
  base.curriculum_id, base.product_id,
  CASE
    WHEN base.is_published OR base.package_status = 'published' THEN 'published'
    WHEN base.package_status = 'blocked'                        THEN 'blocked'
    WHEN base.package_status IN ('failed','error')              THEN 'failed'
    WHEN base.package_status IN ('building','processing')       THEN 'building'
    WHEN base.package_status IN ('queued','pending','ready')    THEN 'queued'
    WHEN base.package_status IN ('draft','new')                 THEN 'draft'
    ELSE COALESCE(base.package_status,'unknown')
  END AS build_state,
  CASE
    WHEN base.bronze_locked THEN 'bronze'
    WHEN base.council_approved AND COALESCE(base.integrity_passed,false) THEN 'approved'
    WHEN base.council_approved THEN 'review'
    ELSE 'not_reviewed'
  END AS governance_state,
  CASE
    WHEN cs.sellable IS TRUE THEN 'ready'
    WHEN cs.commerce_gate_state IS NOT NULL THEN cs.commerce_gate_state
    ELSE 'gap'
  END AS commerce_state,
  CASE
    WHEN cs.customer_safe IS TRUE  THEN 'customer_safe'
    WHEN cs.customer_safe IS FALSE THEN 'gap'
    ELSE 'unknown'
  END AS customer_state,
  CASE
    WHEN g.package_id IS NULL    THEN 'unmeasured'
    WHEN g.seo_signal_count >= 4 THEN 'complete'
    WHEN g.seo_signal_count >= 2 THEN 'partial'
    ELSE 'minimal'
  END AS seo_state,
  CASE
    WHEN b.b2b_enabled IS TRUE AND COALESCE(b.b2b_seat_max,0) > 0
         AND cs.customer_safe IS TRUE     THEN 'enterprise_ready'
    WHEN b.b2b_enabled IS TRUE            THEN 'enterprise_partial'
    WHEN b.product_id IS NOT NULL         THEN 'b2c_only'
    ELSE 'undefined'
  END AS b2b_state,
  CASE
    WHEN base.locked_at IS NOT NULL AND base.locked_at > now() - interval '30 minutes' THEN 'locked'
    WHEN base.blocked_reason IS NOT NULL THEN 'blocked'
    WHEN base.package_status = 'failed' THEN 'repairable'
    WHEN base.package_status IN ('queued','building') AND COALESCE(base.last_error,'') <> '' THEN 'stuck'
    ELSE 'clean'
  END AS ops_state,
  COALESCE(cs.customer_safe, false) AS customer_safe,
  (
    (base.locked_at IS NOT NULL AND base.locked_at > now() - interval '30 minutes')
    OR base.blocked_reason IS NOT NULL
    OR base.bronze_locked
    OR (base.council_approved AND NOT COALESCE(base.integrity_passed,false))
  ) AS ops_attention_required,
  (COALESCE(g.seo_signal_count,0) >= 4) AS growth_ready,
  (COALESCE(b.b2b_enabled,false) AND COALESCE(cs.customer_safe,false)) AS enterprise_ready,
  jsonb_build_object(
    'build',      jsonb_build_object('status', base.package_status, 'progress', base.build_progress, 'step', base.current_step, 'last_error', base.last_error),
    'governance', jsonb_build_object('council_approved', base.council_approved, 'integrity_passed', base.integrity_passed, 'bronze_locked', base.bronze_locked),
    'commerce',   jsonb_build_object('commerce_gate_state', cs.commerce_gate_state, 'sellable', cs.sellable),
    'customer',   jsonb_build_object('customer_safe', cs.customer_safe, 'missing_dimensions', cs.missing_dimensions, 'gap_class', cs.gap_class, 'sub_flags', cs.sub_flags),
    'seo',        jsonb_build_object('signal_count', g.seo_signal_count, 'has_blog', g.has_blog, 'has_og_image', g.has_og_image, 'has_indexnow', g.has_indexnow, 'has_internal_links', g.has_internal_links, 'campaign', g.has_campaign_assets, 'distribution', g.has_distribution_targets),
    'b2b',        jsonb_build_object('enabled', b.b2b_enabled, 'seat_min', b.b2b_seat_min, 'seat_max', b.b2b_seat_max),
    'ops',        jsonb_build_object('locked_at', base.locked_at, 'blocked_reason', base.blocked_reason, 'bronze_locked', base.bronze_locked)
  ) AS state_payload,
  base.is_published, base.published_at
FROM base
LEFT JOIN cs ON cs.package_id = base.package_id
LEFT JOIN g  ON g.package_id  = base.package_id
LEFT JOIN b  ON b.product_id  = base.product_id;

REVOKE ALL ON public.v_package_operational_state_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_operational_state_v1 TO service_role;