
CREATE OR REPLACE FUNCTION public.admin_merge_duplicate_certification_products(p_apply boolean DEFAULT false)
RETURNS TABLE (
  certification_id uuid, keep_product_id uuid, keep_title text, keep_reason text,
  archive_product_id uuid, archive_title text, archive_has_price boolean,
  archive_pub_ref boolean, action text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean; v_count int := 0;
BEGIN
  v_is_admin := COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false)
                OR pg_has_role(session_user, 'service_role', 'MEMBER')
                OR session_user IN ('supabase_read_only_user','postgres','supabase_admin');
  IF NOT v_is_admin THEN RAISE EXCEPTION 'admin role required'; END IF;
  IF p_apply AND session_user = 'supabase_read_only_user' THEN
    RAISE EXCEPTION 'apply not allowed in read-only session'; END IF;

  RETURN QUERY
  WITH ranked AS (
    -- Cluster: alle non-archived Produkte (analog zum integrity-View)
    SELECT p.id, p.certification_id AS cert_id, p.title, p.status, p.updated_at,
      EXISTS(SELECT 1 FROM course_packages cp WHERE cp.product_id=p.id AND cp.status='published') AS pub_ref,
      EXISTS(SELECT 1 FROM product_prices pr WHERE pr.product_id=p.id AND pr.active=true) AS has_price,
      ROW_NUMBER() OVER (PARTITION BY p.certification_id ORDER BY
        (EXISTS(SELECT 1 FROM course_packages cp WHERE cp.product_id=p.id AND cp.status='published'))::int DESC,
        (EXISTS(SELECT 1 FROM product_prices pr WHERE pr.product_id=p.id AND pr.active=true))::int DESC,
        (CASE WHEN p.status='active' THEN 0 ELSE 1 END),
        p.updated_at DESC) AS rnk
    FROM products p WHERE p.status <> 'archived' AND p.certification_id IS NOT NULL
  ),
  clusters AS (SELECT cert_id FROM ranked GROUP BY cert_id HAVING COUNT(*) > 1),
  keepers AS (SELECT r.* FROM ranked r JOIN clusters c ON c.cert_id=r.cert_id WHERE r.rnk=1),
  archives AS (SELECT r.* FROM ranked r JOIN clusters c ON c.cert_id=r.cert_id WHERE r.rnk>1)
  SELECT k.cert_id, k.id, k.title,
    CASE WHEN k.pub_ref THEN 'referenced_by_published'
         WHEN k.has_price THEN 'has_active_price'
         ELSE 'most_recent_updated' END,
    a.id, a.title, a.has_price, a.pub_ref,
    CASE WHEN a.pub_ref THEN 'SKIP_PUBLISHED_REF'
         WHEN p_apply THEN 'archived'
         ELSE 'would_archive' END
  FROM keepers k JOIN archives a ON a.cert_id=k.cert_id
  ORDER BY k.cert_id;

  IF p_apply THEN
    WITH ranked AS (
      SELECT p.id, p.certification_id AS cert_id, p.title, p.status,
        EXISTS(SELECT 1 FROM course_packages cp WHERE cp.product_id=p.id AND cp.status='published') AS pub_ref,
        ROW_NUMBER() OVER (PARTITION BY p.certification_id ORDER BY
          (EXISTS(SELECT 1 FROM course_packages cp WHERE cp.product_id=p.id AND cp.status='published'))::int DESC,
          (EXISTS(SELECT 1 FROM product_prices pr WHERE pr.product_id=p.id AND pr.active=true))::int DESC,
          (CASE WHEN p.status='active' THEN 0 ELSE 1 END),
          p.updated_at DESC) AS rnk
        FROM products p WHERE p.status <> 'archived' AND p.certification_id IS NOT NULL
    ),
    clusters AS (SELECT cert_id FROM ranked GROUP BY cert_id HAVING COUNT(*) > 1),
    to_archive AS (SELECT r.id, r.cert_id, r.title FROM ranked r JOIN clusters c ON c.cert_id=r.cert_id
                   WHERE r.rnk>1 AND r.pub_ref=false),
    -- Audit pro betroffenem Preis (NOT NULL constraint). Falls Produkt keinen Preis hat: 1 sentinel-row mit gen_random_uuid → unsauber. Stattdessen NUR loggen, wenn Preise existieren; sonst kein Audit.
    audit_ins AS (
      INSERT INTO stripe_price_sync_audit (product_price_id, action, before_stripe_price_id, after_stripe_price_id,
        amount_cents, currency, reason, metadata, triggered_by, trigger_source)
      SELECT pr.id, 'archive_duplicate_product', pr.stripe_price_id, NULL,
        pr.amount_cents, pr.currency,
        'merge_duplicate_certification_products',
        jsonb_build_object('archived_product_id', t.id, 'certification_id', t.cert_id, 'title', t.title, 'pre_status', (SELECT status FROM products WHERE id=t.id)),
        auth.uid(), 'admin_merge_duplicate_certification_products'
      FROM to_archive t JOIN product_prices pr ON pr.product_id = t.id
      RETURNING 1
    ),
    deactivate_prices AS (
      UPDATE product_prices SET active=false, updated_at=now()
      WHERE product_id IN (SELECT id FROM to_archive) AND active=true
      RETURNING 1
    )
    UPDATE products SET status='archived', updated_at=now() WHERE id IN (SELECT id FROM to_archive);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'archived % duplicate products', v_count;
  END IF;
END; $$;
