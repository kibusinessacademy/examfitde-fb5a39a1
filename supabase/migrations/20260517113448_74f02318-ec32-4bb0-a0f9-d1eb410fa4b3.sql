
CREATE OR REPLACE VIEW public.v_public_sellable_courses AS
WITH course_metrics AS (
  SELECT
    c.id            AS course_id,
    c.title         AS course_title,
    c.curriculum_id,
    c.published_at,
    count(DISTINCT m.id)::integer AS modules,
    count(DISTINCT l.id)::integer AS lessons,
    count(DISTINCT l.id) FILTER (
      WHERE l.generation_status = 'completed' OR l.status = 'ready'
    )::integer AS lessons_ready
  FROM courses c
  LEFT JOIN modules m ON m.course_id = c.id
  LEFT JOIN lessons l ON l.module_id = m.id
  WHERE c.status = 'published'::course_status
  GROUP BY c.id, c.title, c.curriculum_id, c.published_at
),
priced_products AS (
  SELECT
    p.id AS product_id,
    p.title AS product_title,
    p.slug  AS product_slug,
    p.curriculum_id,
    p.status     AS product_status,
    p.visibility AS product_visibility,
    min(pp.amount_cents) AS min_price_cents,
    max(pp.currency)     AS currency,
    bool_or(pp.stripe_price_id IS NOT NULL) AS has_stripe_price
  FROM products p
  JOIN product_prices pp ON pp.product_id = p.id AND pp.active = true
  WHERE p.status = 'active'
    AND p.visibility = 'public'
    AND p.curriculum_id IS NOT NULL
  GROUP BY p.id, p.title, p.slug, p.curriculum_id, p.status, p.visibility
),
lessons_policy AS (
  SELECT
    cp.curriculum_id,
    bool_or(g.classification IN ('HAS_READY','EXEMPT')) AS lessons_sellable,
    bool_or(g.classification = 'EXEMPT') AS any_exempt
  FROM course_packages cp
  JOIN public.v_lessons_gap_ssot g ON g.package_id = cp.id
  WHERE cp.status = 'published'
  GROUP BY cp.curriculum_id
)
SELECT
  cm.course_id,
  cm.course_title,
  cm.curriculum_id,
  cm.modules,
  cm.lessons,
  cm.lessons_ready,
  cm.published_at,
  pp.product_id,
  pp.product_title,
  pp.product_slug,
  pp.min_price_cents,
  pp.currency,
  pp.has_stripe_price,
  (
    pp.product_id IS NOT NULL
    AND pp.product_slug IS NOT NULL
    AND pp.has_stripe_price
    AND COALESCE(lp.lessons_sellable, false)
  ) AS is_sellable,
  COALESCE(lp.lessons_sellable, false) AS lessons_sellable,
  COALESCE(lp.any_exempt,       false) AS any_exempt
FROM course_metrics cm
JOIN priced_products pp ON pp.curriculum_id = cm.curriculum_id
LEFT JOIN lessons_policy lp ON lp.curriculum_id = cm.curriculum_id;

COMMENT ON VIEW public.v_public_sellable_courses IS
'E2: is_sellable nutzt lessons_sellable aus v_lessons_gap_ssot (HAS_READY|EXEMPT). Keine eigene lessons_ready>0-Logik mehr.';

DO $$
BEGIN
  PERFORM public.fn_emit_audit(
    'public_sellable_policy_alignment_e2',
    jsonb_build_object(
      'view', 'v_public_sellable_courses',
      'policy', 'lessons_sellable := HAS_READY OR EXEMPT (v_lessons_gap_ssot)',
      'phase', 'E2'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'audit emit skipped: %', SQLERRM;
END $$;
