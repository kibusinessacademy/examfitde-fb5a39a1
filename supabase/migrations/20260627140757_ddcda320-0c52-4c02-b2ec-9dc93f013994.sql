CREATE OR REPLACE FUNCTION public.cleanup_iap_smoke_artifacts(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_deleted_receipts int := 0;
  v_deleted_entitlements int := 0;
  v_receipt_ids uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    p_user_id := v_caller;
  END IF;
  IF p_user_id <> v_caller THEN
    RAISE EXCEPTION 'self_only' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(id) INTO v_receipt_ids
    FROM public.store_receipts
   WHERE user_id = p_user_id
     AND transaction_id LIKE 'SMOKE-%';

  IF v_receipt_ids IS NOT NULL THEN
    DELETE FROM public.entitlements
     WHERE user_id = p_user_id
       AND store_receipt_id = ANY(v_receipt_ids);
    GET DIAGNOSTICS v_deleted_entitlements = ROW_COUNT;

    DELETE FROM public.store_receipts
     WHERE id = ANY(v_receipt_ids);
    GET DIAGNOSTICS v_deleted_receipts = ROW_COUNT;
  END IF;

  BEGIN
    PERFORM public.fn_emit_audit(
      'iap_smoke_cleanup',
      jsonb_build_object(
        'actor', v_caller,
        'deleted_receipts', v_deleted_receipts,
        'deleted_entitlements', v_deleted_entitlements
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_receipts', v_deleted_receipts,
    'deleted_entitlements', v_deleted_entitlements
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_iap_smoke_artifacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_iap_smoke_artifacts(uuid) TO authenticated;