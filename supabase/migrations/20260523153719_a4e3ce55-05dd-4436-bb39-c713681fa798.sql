CREATE OR REPLACE FUNCTION public.fn_derive_canonical_slug(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text;
BEGIN
  IF _raw IS NULL OR length(btrim(_raw)) = 0 THEN
    RETURN NULL;
  END IF;
  s := lower(btrim(_raw));
  s := replace(s, 'ä', 'ae');
  s := replace(s, 'ö', 'oe');
  s := replace(s, 'ü', 'ue');
  s := replace(s, 'ß', 'ss');
  s := translate(s,
    'áàâãåéèêëíìîïóòôõúùûýÿñç',
    'aaaaaeeeeiiiiooooouuuyync');
  s := regexp_replace(s, '[/_]+', '-', 'g');
  s := regexp_replace(s, '-[0-9a-f]{6,8}([_-]+archived[_-]+[0-9a-f]+)?$', '');
  s := regexp_replace(s, '-(frau|innen|in)(?=-|$)', '', 'g');
  s := regexp_replace(s, '-{2,}', '-', 'g');
  s := regexp_replace(s, '^-|-$', '', 'g');
  s := regexp_replace(s, '[^a-z0-9-]', '', 'g');
  RETURN s;
END;
$$;

COMMENT ON FUNCTION public.fn_derive_canonical_slug(text) IS
'SSOT canonical commerce slug derivation. Frozen contract — IMMUTABLE for generated column.';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS canonical_slug text
  GENERATED ALWAYS AS (public.fn_derive_canonical_slug(slug)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS ux_products_canonical_slug_active
  ON public.products(canonical_slug)
  WHERE status = 'active' AND canonical_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_canonical_slug
  ON public.products(canonical_slug);

INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES
  ('commerce_canonical_redirect',
   ARRAY['from_slug','to_slug','route']::text[], 1, 'commerce'),
  ('funnel_smoke_run_summary',
   ARRAY['run_id','total','success','failed']::text[], 1, 'commerce'),
  ('funnel_smoke_alert',
   ARRAY['run_id','success_rate','failed_count']::text[], 1, 'commerce')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_public_sellable_courses AS
WITH course_metrics AS (
  SELECT c.id AS course_id,
    c.title AS course_title,
    c.curriculum_id,
    c.published_at,
    count(DISTINCT m.id)::integer AS modules,
    count(DISTINCT l.id)::integer AS lessons,
    count(DISTINCT l.id) FILTER (WHERE l.generation_status = 'completed' OR l.status = 'ready')::integer AS lessons_ready
  FROM courses c
    LEFT JOIN modules m ON m.course_id = c.id
    LEFT JOIN lessons l ON l.module_id = m.id
  WHERE c.status = 'published'::course_status
  GROUP BY c.id, c.title, c.curriculum_id, c.published_at
), priced_products AS (
  SELECT p.id AS product_id,
    p.title AS product_title,
    p.slug AS product_slug,
    p.canonical_slug,
    p.curriculum_id,
    p.status AS product_status,
    p.visibility AS product_visibility,
    min(pp_1.amount_cents) AS min_price_cents,
    max(pp_1.currency) AS currency,
    bool_or(pp_1.stripe_price_id IS NOT NULL) AS has_stripe_price
  FROM products p
    JOIN product_prices pp_1 ON pp_1.product_id = p.id AND pp_1.active = true
  WHERE p.status = 'active' AND p.visibility = 'public' AND p.curriculum_id IS NOT NULL
  GROUP BY p.id, p.title, p.slug, p.canonical_slug, p.curriculum_id, p.status, p.visibility
), lessons_policy AS (
  SELECT cp.curriculum_id,
    bool_or(g.classification = ANY (ARRAY['HAS_READY','EXEMPT'])) AS lessons_sellable,
    bool_or(g.classification = 'EXEMPT') AS any_exempt
  FROM course_packages cp
    JOIN v_lessons_gap_ssot g ON g.package_id = cp.id
  WHERE cp.status = 'published'
  GROUP BY cp.curriculum_id
)
SELECT cm.course_id,
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
  (pp.product_id IS NOT NULL AND pp.product_slug IS NOT NULL AND pp.has_stripe_price AND COALESCE(lp.lessons_sellable, false)) AS is_sellable,
  COALESCE(lp.lessons_sellable, false) AS lessons_sellable,
  COALESCE(lp.any_exempt, false) AS any_exempt,
  pp.canonical_slug
FROM course_metrics cm
  JOIN priced_products pp ON pp.curriculum_id = cm.curriculum_id
  LEFT JOIN lessons_policy lp ON lp.curriculum_id = cm.curriculum_id;

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata, created_at)
VALUES (
  'schema_migration_applied',
  'system',
  'success',
  jsonb_build_object(
    'migration', 'canonical_commerce_slug_ssot_v1',
    'phase', 'P0.1',
    'objects', ARRAY['fn_derive_canonical_slug','products.canonical_slug','ux_products_canonical_slug_active','v_public_sellable_courses']
  ),
  now()
);
