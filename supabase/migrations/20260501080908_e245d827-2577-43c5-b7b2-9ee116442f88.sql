-- 1) Alte Funktion droppen (Return-Type-Konflikt)
DROP FUNCTION IF EXISTS public.admin_stripe_price_sync_apply(boolean);

-- 2) Neu anlegen mit COUNT(*) Fix
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
  v_mapped_ids uuid[];
  v_review_ids uuid[];
  v_audit_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT array_agg(product_price_id), COUNT(*)::int
    INTO v_mapped_ids, v_mapped_count
  FROM public.v_stripe_price_sync_preview
  WHERE action_needed = 'mapped_from_lookup';

  SELECT array_agg(product_price_id), COUNT(*)::int
    INTO v_review_ids, v_review_count
  FROM public.v_stripe_price_sync_preview
  WHERE action_needed = 'manual_review_needed';

  INSERT INTO public.stripe_price_sync_audit (
    actor_user_id, dry_run, mapped_count, review_count,
    mapped_price_ids, review_price_ids, ran_at
  ) VALUES (
    v_uid, p_dry_run, COALESCE(v_mapped_count,0), COALESCE(v_review_count,0),
    COALESCE(v_mapped_ids, ARRAY[]::uuid[]),
    COALESCE(v_review_ids, ARRAY[]::uuid[]),
    now()
  )
  RETURNING id INTO v_audit_id;

  IF NOT p_dry_run AND v_mapped_count > 0 THEN
    UPDATE public.product_prices pp
       SET stripe_price_id = m.suggested_stripe_price_id,
           updated_at = now()
      FROM public.v_stripe_price_sync_preview m
     WHERE pp.id = m.product_price_id
       AND m.action_needed = 'mapped_from_lookup'
       AND (pp.stripe_price_id IS NULL OR pp.stripe_price_id = '');
  END IF;

  RETURN jsonb_build_object(
    'audit_id', v_audit_id,
    'dry_run', p_dry_run,
    'mapped_count', COALESCE(v_mapped_count,0),
    'review_count', COALESCE(v_review_count,0)
  );
END;
$$;

-- 3) View-Lockdown
REVOKE ALL ON public.v_stripe_price_sync_preview FROM PUBLIC;
REVOKE ALL ON public.v_stripe_price_sync_preview FROM anon;
REVOKE ALL ON public.v_stripe_price_sync_preview FROM authenticated;
GRANT SELECT ON public.v_stripe_price_sync_preview TO service_role;

-- 4) Admin-RPC-Wrapper für Vorschau
DROP FUNCTION IF EXISTS public.admin_stripe_price_sync_preview();

CREATE OR REPLACE FUNCTION public.admin_stripe_price_sync_preview()
RETURNS TABLE (
  product_price_id uuid,
  product_id uuid,
  product_title text,
  amount_cents int,
  currency text,
  billing_type text,
  access_months int,
  current_stripe_price_id text,
  suggested_stripe_price_id text,
  suggested_tier_label text,
  action_needed text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  RETURN QUERY
  SELECT v.product_price_id, v.product_id, v.product_title, v.amount_cents,
         v.currency, v.billing_type, v.access_months,
         v.current_stripe_price_id, v.suggested_stripe_price_id,
         v.suggested_tier_label, v.action_needed, v.reason
  FROM public.v_stripe_price_sync_preview v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stripe_price_sync_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stripe_price_sync_preview() TO authenticated, service_role;