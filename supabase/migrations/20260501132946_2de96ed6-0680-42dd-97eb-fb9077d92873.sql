CREATE OR REPLACE FUNCTION public.get_user_account_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;

  SELECT jsonb_build_object(
    'user_id', v_user_id,
    'active_courses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'grant_id', g.id,
        'curriculum_id', g.curriculum_id,
        'product_id', g.product_id,
        'package_id', cp.id,
        'package_title', cp.title,
        'package_key', cp.package_key,
        'status', g.status,
        'onboarding_status', g.onboarding_status,
        'granted_at', g.granted_at,
        'activated_at', g.activated_at
      ) ORDER BY g.granted_at DESC)
      FROM learner_course_grants g
      LEFT JOIN course_packages cp ON cp.curriculum_id = g.curriculum_id AND cp.status='published'
      WHERE g.user_id = v_user_id AND g.status IN ('active','granted')
    ), '[]'::jsonb),
    'invoice_count', (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.id=i.order_id WHERE o.buyer_user_id = v_user_id),
    'latest_invoice', (
      SELECT jsonb_build_object(
        'id', i.id,
        'invoice_number', i.invoice_number,
        'issue_date', i.issue_date,
        'total_gross_cents', i.total_gross_cents,
        'pdf_url', i.pdf_url,
        'status', i.status
      )
      FROM invoices i JOIN orders o ON o.id=i.order_id
      WHERE o.buyer_user_id = v_user_id
      ORDER BY i.issue_date DESC NULLS LAST, i.created_at DESC
      LIMIT 1
    ),
    'license_packages_owned', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'package_id', lp.id,
        'product_id', lp.product_id,
        'quantity', lp.quantity,
        'seats_assigned', (SELECT COUNT(*) FROM license_seats s WHERE s.package_id=lp.id AND s.assigned_user_id IS NOT NULL),
        'purchased_at', lp.purchased_at,
        'expires_at', lp.expires_at,
        'status', lp.status,
        'stripe_invoice_url', lp.stripe_invoice_url
      ) ORDER BY lp.purchased_at DESC)
      FROM license_packages lp
      WHERE lp.buyer_user_id = v_user_id
    ), '[]'::jsonb),
    'pending_gdpr_request', (
      SELECT jsonb_build_object(
        'id', r.id,
        'status', r.status,
        'requested_at', r.requested_at,
        'scheduled_deletion_at', r.scheduled_deletion_at
      )
      FROM gdpr_deletion_requests r
      WHERE r.user_id = v_user_id AND r.status IN ('pending','confirmed')
      ORDER BY r.requested_at DESC
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'app_dashboard_rpc_fix',
  'system',
  'get_user_account_summary',
  'success',
  jsonb_build_object(
    'fix', 'canonical_slug → package_key',
    'reason', 'canonical_slug spalte existiert nicht in course_packages',
    'detected_during', 'e2e_smoke_hybrid_v1',
    'replaced_field', 'package_slug → package_key'
  )
);