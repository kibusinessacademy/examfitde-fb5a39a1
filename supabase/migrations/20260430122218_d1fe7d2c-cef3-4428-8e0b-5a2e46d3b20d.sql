CREATE OR REPLACE VIEW public.v_pricing_merge_candidates AS
WITH per_product AS (
  SELECT
    p.id AS product_id,
    p.certification_id,
    p.title,
    p.slug,
    p.status,
    EXISTS (
      SELECT 1 FROM public.product_prices pp
      WHERE pp.product_id = p.id AND pp.active = true
    ) AS has_active_price
  FROM public.products p
  WHERE p.status <> 'archived'
    AND p.certification_id IS NOT NULL
),
agg AS (
  SELECT
    certification_id,
    (array_agg(product_id) FILTER (WHERE has_active_price))[1] AS canonical_product_id,
    (array_agg(product_id) FILTER (WHERE NOT has_active_price AND status = 'draft'))[1] AS duplicate_product_id,
    count(*) AS total_products,
    count(*) FILTER (WHERE has_active_price) AS priced_products,
    count(*) FILTER (WHERE NOT has_active_price AND status = 'draft') AS unpriced_drafts
  FROM per_product
  GROUP BY certification_id
)
SELECT
  a.certification_id,
  a.canonical_product_id,
  a.duplicate_product_id,
  a.total_products,
  a.priced_products,
  a.unpriced_drafts,
  pc.title AS canonical_title,
  pd.title AS duplicate_title,
  pd.slug  AS duplicate_slug
FROM agg a
LEFT JOIN public.products pc ON pc.id = a.canonical_product_id
LEFT JOIN public.products pd ON pd.id = a.duplicate_product_id
WHERE a.total_products > 1
  AND a.priced_products = 1
  AND a.unpriced_drafts >= 1;

GRANT SELECT ON public.v_pricing_merge_candidates TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_pricing_merge_duplicates(
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  certification_id uuid,
  canonical_product_id uuid,
  duplicate_product_id uuid,
  duplicate_title text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR v_rec IN SELECT * FROM public.v_pricing_merge_candidates LOOP
    IF p_dry_run THEN
      certification_id := v_rec.certification_id;
      canonical_product_id := v_rec.canonical_product_id;
      duplicate_product_id := v_rec.duplicate_product_id;
      duplicate_title := v_rec.duplicate_title;
      action := 'would_archive';
      RETURN NEXT;
    ELSE
      UPDATE public.products
         SET status = 'archived',
             slug = COALESCE(slug, '') || '-archived-' || extract(epoch from now())::bigint::text,
             updated_at = now()
       WHERE id = v_rec.duplicate_product_id;

      INSERT INTO public.auto_heal_log (
        action_type, target_type, target_id, result_status, result_detail,
        trigger_source, metadata
      ) VALUES (
        'pricing_merge_duplicate_product', 'product', v_rec.duplicate_product_id,
        'success',
        format('Archived duplicate product (canonical=%s)', v_rec.canonical_product_id),
        'admin_pricing_merge_duplicates',
        jsonb_build_object(
          'certification_id', v_rec.certification_id,
          'canonical_product_id', v_rec.canonical_product_id,
          'duplicate_title', v_rec.duplicate_title
        )
      );

      certification_id := v_rec.certification_id;
      canonical_product_id := v_rec.canonical_product_id;
      duplicate_product_id := v_rec.duplicate_product_id;
      duplicate_title := v_rec.duplicate_title;
      action := 'archived';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pricing_merge_duplicates(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pricing_merge_duplicates(boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_pricing_merge_duplicates(boolean) IS
'Datengetriebene Merge-Heal: archiviert preislose draft-Duplikate, wenn pro certification_id genau ein priced canonical existiert. Default Dry-Run.';