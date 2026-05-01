-- PATCH 1: Hotfix admin_stripe_price_sync_apply auf echtes per-row Audit-Schema
DROP FUNCTION IF EXISTS public.admin_stripe_price_sync_apply(boolean);

CREATE OR REPLACE FUNCTION public.admin_stripe_price_sync_apply(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mapped_count int := 0;
  v_review_count int := 0;
  v_applied_count int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  -- Audit per-row für mapped (entweder dry_run oder apply)
  IF p_dry_run THEN
    INSERT INTO public.stripe_price_sync_audit
      (product_price_id, action, before_stripe_price_id, after_stripe_price_id,
       amount_cents, currency, reason, metadata, triggered_by, trigger_source)
    SELECT
      v.product_price_id,
      'dry_run_mapped_from_lookup',
      v.current_stripe_price_id,
      v.suggested_stripe_price_id,
      v.amount_cents,
      v.currency,
      v.reason,
      jsonb_build_object('tier_label', v.suggested_tier_label),
      v_uid,
      'admin_rpc'
    FROM public.v_stripe_price_sync_preview v
    WHERE v.action_needed = 'mapped_from_lookup';
    GET DIAGNOSTICS v_mapped_count = ROW_COUNT;
  ELSE
    WITH applied AS (
      UPDATE public.product_prices pp
         SET stripe_price_id = v.suggested_stripe_price_id,
             updated_at = now()
        FROM public.v_stripe_price_sync_preview v
       WHERE pp.id = v.product_price_id
         AND v.action_needed = 'mapped_from_lookup'
         AND (pp.stripe_price_id IS NULL OR pp.stripe_price_id = '')
      RETURNING pp.id AS product_price_id, pp.stripe_price_id AS new_id
    ),
    audit_ins AS (
      INSERT INTO public.stripe_price_sync_audit
        (product_price_id, action, before_stripe_price_id, after_stripe_price_id,
         amount_cents, currency, reason, metadata, triggered_by, trigger_source)
      SELECT
        a.product_price_id,
        'apply_mapped_from_lookup',
        NULL,
        a.new_id,
        v.amount_cents,
        v.currency,
        v.reason,
        jsonb_build_object('tier_label', v.suggested_tier_label),
        v_uid,
        'admin_rpc'
      FROM applied a
      JOIN public.v_stripe_price_sync_preview v ON v.product_price_id = a.product_price_id
      RETURNING 1
    )
    SELECT COUNT(*)::int INTO v_applied_count FROM audit_ins;
    v_mapped_count := v_applied_count;
  END IF;

  -- Audit per-row für manual_review_needed (immer, auch bei apply)
  INSERT INTO public.stripe_price_sync_audit
    (product_price_id, action, before_stripe_price_id, after_stripe_price_id,
     amount_cents, currency, reason, metadata, triggered_by, trigger_source)
  SELECT
    v.product_price_id,
    'manual_review_needed',
    v.current_stripe_price_id,
    NULL,
    v.amount_cents,
    v.currency,
    v.reason,
    jsonb_build_object('product_title', v.product_title, 'billing_type', v.billing_type),
    v_uid,
    'admin_rpc'
  FROM public.v_stripe_price_sync_preview v
  WHERE v.action_needed = 'manual_review_needed';
  GET DIAGNOSTICS v_review_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'mapped_count', v_mapped_count,
    'review_count', v_review_count,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stripe_price_sync_apply(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stripe_price_sync_apply(boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_stripe_price_sync_apply(boolean) IS
'Admin-only. Default Dry-Run. Per-row Audit nach echtem Schema von stripe_price_sync_audit.';