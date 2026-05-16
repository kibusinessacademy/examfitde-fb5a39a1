-- 1) Registry rows (idempotent)
INSERT INTO public.ops_job_type_registry (job_type, job_name, lane, pool, requires_package_id, is_governance, is_active, description)
VALUES
  ('commerce_product_visibility_check', 'commerce_product_visibility_check', 'control', 'control', true, true, true,
   'Post-publish gate: verify package has an active public product.'),
  ('commerce_price_activation_check',  'commerce_price_activation_check',  'control', 'control', true, true, true,
   'Post-publish gate: verify package has at least one active Stripe price.'),
  ('commerce_sellability_gate_check',  'commerce_sellability_gate_check',  'control', 'control', true, true, true,
   'Post-publish gate: verify package is sellable via v_public_sellable_courses. PASS triggers SEO/CRM fanout.'),
  ('commerce_audit_snapshot',          'commerce_audit_snapshot',          'control', 'control', true, true, true,
   'Post-publish: capture commerce-gate flags snapshot to auto_heal_log.'),
  ('commerce_repair_product_missing',     'commerce_repair_product_missing',     'control', 'control', true, true, true,
   'Repair signal: published package has no active public product.'),
  ('commerce_repair_price_missing',       'commerce_repair_price_missing',       'control', 'control', true, true, true,
   'Repair signal: published package has product but no active Stripe price.'),
  ('commerce_repair_lesson_gate_failed',  'commerce_repair_lesson_gate_failed',  'control', 'control', true, true, true,
   'Repair signal: published package fails v_public_sellable_courses lesson_ready gate.')
ON CONFLICT (job_type) DO UPDATE
SET job_name = EXCLUDED.job_name,
    lane = EXCLUDED.lane,
    pool = EXCLUDED.pool,
    requires_package_id = EXCLUDED.requires_package_id,
    is_governance = EXCLUDED.is_governance,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    updated_at = now();

-- 2) SSOT View
CREATE OR REPLACE VIEW public.v_post_publish_commerce_status_ssot AS
WITH pubs AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title AS package_title, cp.curriculum_id
  FROM public.course_packages cp
  WHERE cp.status = 'published' AND COALESCE(cp.is_published, false) = true
),
product_flags AS (
  SELECT pr.curriculum_id,
         bool_or(pr.status='active' AND pr.visibility='public') AS product_public,
         bool_or(pr.status='active') AS product_any_active
  FROM public.products pr
  WHERE pr.curriculum_id IS NOT NULL
  GROUP BY pr.curriculum_id
),
sellable_flags AS (
  SELECT v.curriculum_id,
         bool_or(COALESCE(v.is_sellable,false) AND COALESCE(v.has_stripe_price,false)) AS is_sellable,
         bool_or(COALESCE(v.has_stripe_price,false)) AS has_stripe_price,
         bool_or(COALESCE(v.lessons_ready,0) > 0) AS lesson_ready
  FROM public.v_public_sellable_courses v
  GROUP BY v.curriculum_id
)
SELECT
  p.package_id,
  p.package_key,
  p.package_title,
  p.curriculum_id,
  COALESCE(pf.product_public, false)   AS product_public,
  COALESCE(pf.product_any_active,false) AS product_any_active,
  COALESCE(sf.has_stripe_price, false) AS has_stripe_price,
  COALESCE(sf.lesson_ready, false)     AS lesson_ready,
  COALESCE(sf.is_sellable, false)      AS is_sellable,
  CASE
    WHEN COALESCE(sf.is_sellable,false) THEN 'PASS'
    WHEN NOT COALESCE(pf.product_public,false) THEN 'PRODUCT_MISSING'
    WHEN NOT COALESCE(sf.has_stripe_price,false) THEN 'PRICE_MISSING'
    WHEN NOT COALESCE(sf.lesson_ready,false) THEN 'LESSON_GATE_FAILED'
    ELSE 'NOT_SELLABLE'
  END AS gate_state
FROM pubs p
LEFT JOIN product_flags pf  ON pf.curriculum_id = p.curriculum_id
LEFT JOIN sellable_flags sf ON sf.curriculum_id = p.curriculum_id;

-- Lock down per SSOT memory rule (admin views: no anon/authenticated grants)
REVOKE ALL ON public.v_post_publish_commerce_status_ssot FROM PUBLIC;
REVOKE ALL ON public.v_post_publish_commerce_status_ssot FROM anon, authenticated;
GRANT SELECT ON public.v_post_publish_commerce_status_ssot TO service_role;

-- 3) Admin RPC wrapper
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_commerce_status(
  p_limit integer DEFAULT 200,
  p_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lim integer := GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
  v_rows jsonb;
  v_summary jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_get_post_publish_commerce_status: forbidden (admin only)';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT *
    FROM public.v_post_publish_commerce_status_ssot
    WHERE p_state IS NULL OR gate_state = p_state
    ORDER BY gate_state, package_title
    LIMIT v_lim
  ) t;

  SELECT jsonb_object_agg(gate_state, c)
    INTO v_summary
  FROM (
    SELECT gate_state, COUNT(*)::int AS c
    FROM public.v_post_publish_commerce_status_ssot
    GROUP BY gate_state
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'count',   jsonb_array_length(v_rows),
    'rows',    v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_publish_commerce_status(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_commerce_status(integer, text) TO authenticated;

-- 4) Baseline snapshot
DO $$
DECLARE v_summary jsonb;
BEGIN
  SELECT jsonb_object_agg(gate_state, c)
    INTO v_summary
  FROM (
    SELECT gate_state, COUNT(*)::int AS c
    FROM public.v_post_publish_commerce_status_ssot
    GROUP BY gate_state
  ) s;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('commerce_gate_ssot_baseline', 'system', 'post_publish_commerce', 'ok',
          jsonb_build_object('snapshot_at', now(), 'distribution', COALESCE(v_summary, '{}'::jsonb)));
END $$;