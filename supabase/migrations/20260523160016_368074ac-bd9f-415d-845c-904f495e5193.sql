
INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES
  ('commerce_gap_snapshot',           ARRAY['total','with_gaps','severity_max']::text[], 1, 'commerce_orchestrator'),
  ('commerce_heal_dispatch_attempt',  ARRAY['package_id','gap_codes','decision']::text[], 1, 'commerce_orchestrator'),
  ('commerce_heal_repair_done',       ARRAY['package_id','gap_code','job_id']::text[],   1, 'commerce_orchestrator'),
  ('commerce_heal_verify_smoked',     ARRAY['package_id','smoke_run_id','success']::text[], 1, 'commerce_orchestrator'),
  ('commerce_heal_state_transition',  ARRAY['package_id','from_state','to_state']::text[], 1, 'commerce_orchestrator'),
  ('commerce_auto_promote_enqueued',  ARRAY['package_id','reason']::text[],              1, 'commerce_orchestrator')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_commerce_gap_classification AS
WITH base AS (
  SELECT
    cp.id                AS package_id,
    cp.package_key,
    cp.title             AS package_title,
    cp.status::text      AS package_status,
    cp.is_published,
    cp.certification_id,
    cp.product_id,
    p.canonical_slug,
    p.slug               AS product_slug,
    p.visibility         AS product_visibility,
    csv.delivery_ready,
    csv.lessons_delivery_ready,
    csv.exam_pool_ready,
    csv.tutor_ready,
    csv.entitlement_ready,
    csv.sellable,
    csv.published        AS csv_published,
    sd.has_stripe_price,
    sd.is_sellable_and_deliverable,
    public.fn_is_bronze_locked(cp.id) AS bronze_locked,
    COALESCE((public.fn_package_pricing_ready(cp.id)->>'ready')::boolean, false) AS pricing_ready
  FROM public.course_packages cp
  LEFT JOIN public.products p ON p.id = cp.product_id
  LEFT JOIN public.v_package_customer_safe_v1 csv ON csv.package_id = cp.id
  LEFT JOIN public.v_sellable_and_deliverable  sd  ON sd.course_package_id = cp.id
  WHERE cp.archived IS NOT TRUE
), seo AS (
  SELECT certification_catalog_id AS certification_id,
         BOOL_OR(is_published) AS has_published_pillar
    FROM public.certification_seo_pages
   GROUP BY certification_catalog_id
), last_smoke AS (
  SELECT
    NULLIF(metadata->>'run_id','')::uuid                  AS smoke_run_id,
    metadata->'failed_slugs'                              AS failed_slugs,
    created_at                                            AS smoke_created_at
  FROM public.auto_heal_log
  WHERE action_type = 'funnel_smoke_run_summary'
    AND created_at > now() - interval '26 hours'
  ORDER BY created_at DESC
  LIMIT 1
), per_pkg_smoke AS (
  SELECT
    b.package_id,
    ls.smoke_run_id,
    ls.smoke_created_at,
    CASE
      WHEN ls.failed_slugs IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(ls.failed_slugs) f
        WHERE f->>'slug' = b.canonical_slug
      ) THEN false
      ELSE true
    END AS smoke_success
  FROM base b
  CROSS JOIN last_smoke ls
), gaps AS (
  SELECT
    b.*,
    s.has_published_pillar,
    pps.smoke_run_id,
    pps.smoke_success,
    pps.smoke_created_at,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN b.canonical_slug IS NULL OR b.canonical_slug = '' THEN 'MISSING_CANONICAL' END,
      CASE WHEN b.pricing_ready IS NOT TRUE                       THEN 'MISSING_PRICE' END,
      CASE WHEN b.delivery_ready IS NOT TRUE                      THEN 'MISSING_DELIVERY' END,
      CASE WHEN b.lessons_delivery_ready IS NOT TRUE              THEN 'MISSING_LESSONS' END,
      CASE WHEN b.exam_pool_ready IS NOT TRUE                     THEN 'MISSING_EXAM_POOL' END,
      CASE WHEN b.tutor_ready IS NOT TRUE                         THEN 'MISSING_TUTOR' END,
      CASE WHEN b.entitlement_ready IS NOT TRUE                   THEN 'MISSING_ENTITLEMENT' END,
      CASE WHEN pps.smoke_success IS FALSE                        THEN 'CHECKOUT_FAIL' END,
      CASE WHEN COALESCE(s.has_published_pillar, false) IS NOT TRUE THEN 'SEO_NOT_READY' END
    ]::text[], NULL) AS gap_codes
  FROM base b
  LEFT JOIN seo            s   ON s.certification_id = b.certification_id
  LEFT JOIN per_pkg_smoke  pps ON pps.package_id     = b.package_id
)
SELECT
  package_id,
  package_key,
  package_title,
  package_status,
  is_published,
  product_id,
  canonical_slug,
  product_slug,
  product_visibility,
  COALESCE(csv_published, false)        AS published,
  COALESCE(sellable, false)             AS sellable,
  COALESCE(delivery_ready, false)       AS delivery_ready,
  COALESCE(lessons_delivery_ready, false) AS lessons_delivery_ready,
  COALESCE(exam_pool_ready, false)      AS exam_pool_ready,
  COALESCE(tutor_ready, false)          AS tutor_ready,
  COALESCE(entitlement_ready, false)    AS entitlement_ready,
  COALESCE(has_stripe_price, false)     AS has_stripe_price,
  COALESCE(is_sellable_and_deliverable, false) AS fully_operational,
  bronze_locked,
  pricing_ready,
  smoke_run_id     AS last_smoke_run_id,
  smoke_success    AS last_smoke_success,
  smoke_created_at AS last_smoke_at,
  gap_codes,
  CASE
    WHEN gap_codes = '{}' OR gap_codes IS NULL THEN 0
    WHEN ('CHECKOUT_FAIL' = ANY(gap_codes) OR 'MISSING_PRICE' = ANY(gap_codes))
         AND COALESCE(sellable, false) THEN 3
    WHEN COALESCE(is_published, false) AND (
         'MISSING_DELIVERY'    = ANY(gap_codes)
      OR 'MISSING_LESSONS'     = ANY(gap_codes)
      OR 'MISSING_EXAM_POOL'   = ANY(gap_codes)
      OR 'MISSING_TUTOR'       = ANY(gap_codes)
      OR 'MISSING_ENTITLEMENT' = ANY(gap_codes)) THEN 2
    ELSE 1
  END AS severity
FROM gaps;

REVOKE ALL ON public.v_commerce_gap_classification FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_commerce_gap_classification TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_commerce_gap_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.has_role(auth.uid(), 'admin'::public.app_role)
      THEN jsonb_build_object('error','forbidden')
    ELSE (
      SELECT jsonb_build_object(
        'total',                COUNT(*),
        'fully_operational',    COUNT(*) FILTER (WHERE fully_operational),
        'with_gaps',            COUNT(*) FILTER (WHERE COALESCE(array_length(gap_codes,1),0) > 0),
        'severity_3',           COUNT(*) FILTER (WHERE severity = 3),
        'severity_2',           COUNT(*) FILTER (WHERE severity = 2),
        'severity_1',           COUNT(*) FILTER (WHERE severity = 1),
        'gap_distribution',     (
          SELECT jsonb_object_agg(gc, cnt) FROM (
            SELECT unnest(gap_codes) AS gc, COUNT(*) AS cnt
              FROM public.v_commerce_gap_classification
             WHERE gap_codes IS NOT NULL
             GROUP BY 1
          ) d
        ),
        'last_smoke_at',        MAX(last_smoke_at),
        'last_smoke_run_id',    MAX(last_smoke_run_id::text),
        'snapshot_at',          now()
      )
      FROM public.v_commerce_gap_classification
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_commerce_gap_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_commerce_gap_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_commerce_gap_detail(
  p_severity_min int DEFAULT 1,
  p_limit        int DEFAULT 200,
  p_offset       int DEFAULT 0,
  p_only_visible boolean DEFAULT true
)
RETURNS TABLE (
  package_id uuid,
  package_key text,
  package_title text,
  canonical_slug text,
  is_published boolean,
  sellable boolean,
  fully_operational boolean,
  bronze_locked boolean,
  gap_codes text[],
  severity int,
  last_smoke_success boolean,
  last_smoke_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.package_id, v.package_key, v.package_title, v.canonical_slug,
    v.is_published, v.sellable, v.fully_operational, v.bronze_locked,
    v.gap_codes, v.severity, v.last_smoke_success, v.last_smoke_at
  FROM public.v_commerce_gap_classification v
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND v.severity >= p_severity_min
    AND (NOT p_only_visible OR v.is_published)
  ORDER BY v.severity DESC, v.last_smoke_at DESC NULLS LAST, v.package_title
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;
REVOKE ALL ON FUNCTION public.admin_get_commerce_gap_detail(int,int,int,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_commerce_gap_detail(int,int,int,boolean) TO authenticated, service_role;

COMMENT ON VIEW public.v_commerce_gap_classification IS
  'Stage A SSOT for the Commerce Readiness Orchestrator. Read-only. Service-role only. Access via admin_get_commerce_gap_summary / _detail.';
