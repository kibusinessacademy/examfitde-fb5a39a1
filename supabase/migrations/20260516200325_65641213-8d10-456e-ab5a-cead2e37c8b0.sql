CREATE OR REPLACE VIEW public.v_package_operational_state_v1 AS
WITH base AS (
  SELECT
    cp.id AS package_id, cp.package_key, cp.title AS package_title,
    cp.track::text AS track, cp.status AS package_status,
    cp.curriculum_id, cp.product_id, cp.build_progress, cp.current_step,
    cp.blocked_reason, cp.locked_at, cp.council_approved, cp.integrity_passed,
    COALESCE((cp.feature_flags->>'bronze')::boolean, false) AS bronze_locked,
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

CREATE OR REPLACE FUNCTION public.admin_get_operational_state_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'customer_safe',    COUNT(*) FILTER (WHERE customer_safe),
    'ops_attention',    COUNT(*) FILTER (WHERE ops_attention_required),
    'growth_ready',     COUNT(*) FILTER (WHERE growth_ready),
    'enterprise_ready', COUNT(*) FILTER (WHERE enterprise_ready),
    'by_build',      (SELECT jsonb_object_agg(build_state, c)      FROM (SELECT build_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY build_state) x),
    'by_governance', (SELECT jsonb_object_agg(governance_state, c) FROM (SELECT governance_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY governance_state) x),
    'by_commerce',   (SELECT jsonb_object_agg(commerce_state, c)   FROM (SELECT commerce_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY commerce_state) x),
    'by_customer',   (SELECT jsonb_object_agg(customer_state, c)   FROM (SELECT customer_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY customer_state) x),
    'by_seo',        (SELECT jsonb_object_agg(seo_state, c)        FROM (SELECT seo_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY seo_state) x),
    'by_b2b',        (SELECT jsonb_object_agg(b2b_state, c)        FROM (SELECT b2b_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY b2b_state) x),
    'by_ops',        (SELECT jsonb_object_agg(ops_state, c)        FROM (SELECT ops_state, COUNT(*) c FROM public.v_package_operational_state_v1 GROUP BY ops_state) x),
    'generated_at',  now()
  ) INTO v_result FROM public.v_package_operational_state_v1;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_operational_state_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_operational_state_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_operational_state_packages(
  _build text DEFAULT NULL, _governance text DEFAULT NULL, _commerce text DEFAULT NULL,
  _customer text DEFAULT NULL, _seo text DEFAULT NULL, _b2b text DEFAULT NULL,
  _ops text DEFAULT NULL, _track text DEFAULT NULL, _limit int DEFAULT 100
)
RETURNS TABLE (
  package_id uuid, package_key text, package_title text, track text,
  build_state text, governance_state text, commerce_state text, customer_state text,
  seo_state text, b2b_state text, ops_state text,
  customer_safe boolean, ops_attention_required boolean,
  growth_ready boolean, enterprise_ready boolean, state_payload jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT v.package_id, v.package_key, v.package_title, v.track,
         v.build_state, v.governance_state, v.commerce_state, v.customer_state,
         v.seo_state, v.b2b_state, v.ops_state,
         v.customer_safe, v.ops_attention_required, v.growth_ready, v.enterprise_ready,
         v.state_payload
  FROM public.v_package_operational_state_v1 v
  WHERE (_build      IS NULL OR v.build_state      = _build)
    AND (_governance IS NULL OR v.governance_state = _governance)
    AND (_commerce   IS NULL OR v.commerce_state   = _commerce)
    AND (_customer   IS NULL OR v.customer_state   = _customer)
    AND (_seo        IS NULL OR v.seo_state        = _seo)
    AND (_b2b        IS NULL OR v.b2b_state        = _b2b)
    AND (_ops        IS NULL OR v.ops_state        = _ops)
    AND (_track      IS NULL OR v.track            = _track)
  ORDER BY v.ops_attention_required DESC, v.customer_safe ASC, v.package_title
  LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_operational_state_packages(text,text,text,text,text,text,text,text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_operational_state_packages(text,text,text,text,text,text,text,text,int) TO authenticated;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('operational_state_v1_init', 'system', 'success',
        jsonb_build_object('sprint','S3','dimensions', ARRAY['build','governance','commerce','customer','seo','b2b','ops']));

NOTIFY pgrst, 'reload schema';