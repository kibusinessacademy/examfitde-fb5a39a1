-- ============================================================
-- Bronze Phase 3: Manual Approve & Review List RPCs
-- ============================================================

-- Liste aller Bronze-Review-Pakete für UI
CREATE OR REPLACE FUNCTION public.admin_get_bronze_review_packages()
RETURNS TABLE (
  package_id uuid,
  package_key text,
  title text,
  course_title text,
  status text,
  score numeric,
  badge text,
  verdict text,
  failed_rules jsonb,
  repair_attempts int,
  repair_active boolean,
  final_state text,
  requires_review boolean,
  bronze_started_at timestamptz,
  manual_approved_at timestamptz,
  last_council_at timestamptz,
  integrity_passed boolean,
  pricing_ready boolean,
  has_active_publish_job boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    cp.id AS package_id,
    cp.package_key,
    COALESCE(cp.canonical_title, cp.title) AS title,
    c.title AS course_title,
    cp.status::text,
    NULLIF(cp.feature_flags->'bronze'->>'score','')::numeric AS score,
    cp.feature_flags->'bronze'->>'badge' AS badge,
    cp.feature_flags->'bronze'->>'verdict' AS verdict,
    COALESCE(cp.feature_flags->'bronze'->'failed_rules', '[]'::jsonb) AS failed_rules,
    COALESCE(NULLIF(cp.feature_flags->'bronze'->>'repair_attempts','')::int, 0) AS repair_attempts,
    COALESCE((cp.feature_flags->'bronze'->>'repair_active')::boolean, false) AS repair_active,
    cp.feature_flags->'bronze'->>'final_state' AS final_state,
    COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) AS requires_review,
    NULLIF(cp.feature_flags->'bronze'->>'started_at','')::timestamptz AS bronze_started_at,
    NULLIF(cp.feature_flags->'bronze'->>'manual_approved_at','')::timestamptz AS manual_approved_at,
    NULLIF(cp.feature_flags->'bronze'->>'last_council_at','')::timestamptz AS last_council_at,
    COALESCE(cp.integrity_passed, false) AS integrity_passed,
    public.fn_package_pricing_ready(cp.id) AS pricing_ready,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_auto_publish'
        AND jq.status IN ('queued','pending','processing')
    ) AS has_active_publish_job
  FROM public.course_packages cp
  LEFT JOIN public.courses c ON c.id = cp.course_id
  WHERE COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) = true
  ORDER BY NULLIF(cp.feature_flags->'bronze'->>'started_at','')::timestamptz DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_bronze_review_packages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_bronze_review_packages() TO authenticated;

-- Manual Approve & Publish
CREATE OR REPLACE FUNCTION public.admin_bronze_manual_approve_for_publish(
  p_package_id uuid,
  p_reason text DEFAULT 'admin_manual_review'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_score numeric;
  v_badge text;
  v_pricing_ready boolean;
  v_active_publish boolean;
  v_new_flags jsonb;
  v_job_id uuid;
BEGIN
  -- Gate: admin only
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  -- Load package
  SELECT id, status, feature_flags, integrity_passed, council_approved
    INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found: %', p_package_id;
  END IF;

  -- Guard 1: Must be Bronze-locked
  IF NOT public.fn_is_bronze_locked(p_package_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'NOT_BRONZE_LOCKED',
      'detail', 'Package is not in Bronze review state.'
    );
  END IF;

  -- Guard 2: Score 75–84
  v_score := NULLIF(v_pkg.feature_flags->'bronze'->>'score','')::numeric;
  v_badge := v_pkg.feature_flags->'bronze'->>'badge';
  IF v_score IS NULL OR v_score < 75 OR v_score >= 85 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'SCORE_OUT_OF_BRONZE_WINDOW',
      'score', v_score,
      'badge', v_badge
    );
  END IF;

  -- Guard 3: Integrity must be passed
  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'INTEGRITY_NOT_PASSED'
    );
  END IF;

  -- Guard 4: Pricing must be ready
  v_pricing_ready := public.fn_package_pricing_ready(p_package_id);
  IF NOT v_pricing_ready THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'PRICING_NOT_READY',
      'detail', 'product_id + active price + stripe_price_id required.'
    );
  END IF;

  -- Guard 5: No active auto_publish job
  SELECT EXISTS (
    SELECT 1 FROM public.job_queue
    WHERE package_id = p_package_id
      AND job_type = 'package_auto_publish'
      AND status IN ('queued','pending','processing')
  ) INTO v_active_publish;
  IF v_active_publish THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'ACTIVE_PUBLISH_JOB_EXISTS'
    );
  END IF;

  -- Update bronze state
  v_new_flags := COALESCE(v_pkg.feature_flags, '{}'::jsonb)
    || jsonb_build_object(
      'bronze',
      COALESCE(v_pkg.feature_flags->'bronze', '{}'::jsonb)
        || jsonb_build_object(
          'final_state', 'manual_approved',
          'requires_review', false,
          'repair_active', false,
          'manual_approved_at', now(),
          'manual_approved_by', v_uid,
          'manual_approved_reason', p_reason
        )
    );

  UPDATE public.course_packages
  SET feature_flags = v_new_flags,
      updated_at = now()
  WHERE id = p_package_id;

  -- Enqueue auto_publish with bronze_lock_override
  INSERT INTO public.job_queue (
    package_id,
    job_type,
    status,
    priority,
    payload,
    enqueue_source,
    created_at
  ) VALUES (
    p_package_id,
    'package_auto_publish',
    'queued',
    5,
    jsonb_build_object(
      'bronze_lock_override', true,
      'manual_approved_by', v_uid,
      'reason', p_reason
    ),
    'bronze_manual_approve',
    now()
  )
  RETURNING id INTO v_job_id;

  -- Audit
  INSERT INTO public.auto_heal_log (
    action_type,
    target_type,
    target_id,
    package_id,
    result_status,
    details
  ) VALUES (
    'bronze_manual_approved_for_publish',
    'package',
    p_package_id,
    p_package_id,
    'success',
    jsonb_build_object(
      'package_id', p_package_id,
      'approved_by', v_uid,
      'reason', p_reason,
      'score', v_score,
      'badge', v_badge,
      'job_id', v_job_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'job_id', v_job_id,
    'score', v_score,
    'badge', v_badge,
    'final_state', 'manual_approved'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bronze_manual_approve_for_publish(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bronze_manual_approve_for_publish(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_bronze_manual_approve_for_publish IS
  'Bronze Phase 3: Admin-gated manual approve. Sets final_state=manual_approved + enqueues package_auto_publish with bronze_lock_override=true. Guards: score 75-84, integrity_passed, pricing_ready, no active publish job.';

COMMENT ON FUNCTION public.admin_get_bronze_review_packages IS
  'Bronze Phase 3: Admin-gated list of packages with feature_flags.bronze.requires_review=true.';