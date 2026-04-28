CREATE OR REPLACE FUNCTION public.admin_e2e_run_bundle_check(
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_test_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_test_user uuid;
  v_bundle_id uuid;
  v_bundle_active boolean;
  v_lc_active boolean;
  v_et_active boolean;
  v_active_count integer;
  v_assertions jsonb;
  v_passed integer := 0;
  v_failed integer := 0;
  v_total integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_grant_id uuid;
  v_gate jsonb;
  v_has_pricing boolean;
  v_leftover integer;
  v_cleanup_ok boolean;
  cur RECORD;
  v_started_at timestamptz := now();
BEGIN
  -- Admin gate
  SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Resolve test user (sandbox@examfit.test by default)
  v_test_user := COALESCE(
    p_test_user_id,
    (SELECT id FROM auth.users WHERE email = 'sandbox@examfit.test' LIMIT 1)
  );
  IF v_test_user IS NULL THEN
    RAISE EXCEPTION 'test user not found (sandbox@examfit.test)';
  END IF;

  -- ============================================================
  -- PRE-FLIGHT ASSERTIONS: Bundle-only invariant
  -- ============================================================
  SELECT id, is_active INTO v_bundle_id, v_bundle_active
  FROM store_products WHERE product_key = 'bundle' LIMIT 1;

  SELECT is_active INTO v_lc_active
  FROM store_products WHERE product_key = 'learning_course' LIMIT 1;

  SELECT is_active INTO v_et_active
  FROM store_products WHERE product_key = 'exam_trainer' LIMIT 1;

  SELECT count(*)::int INTO v_active_count
  FROM store_products WHERE is_active = true;

  v_assertions := jsonb_build_object(
    'bundle_active', COALESCE(v_bundle_active, false),
    'learning_course_inactive', v_lc_active IS NOT TRUE,
    'exam_trainer_inactive', v_et_active IS NOT TRUE,
    'only_bundle_active', v_active_count = 1,
    'bundle_id', v_bundle_id
  );

  IF v_bundle_id IS NULL OR NOT v_bundle_active
     OR v_lc_active IS TRUE OR v_et_active IS TRUE
     OR v_active_count <> 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'pre_flight',
      'assertions', v_assertions,
      'started_at', v_started_at,
      'finished_at', now()
    );
  END IF;

  -- ============================================================
  -- PER-CURRICULUM TEST LOOP
  -- ============================================================
  FOR cur IN
    SELECT id, slug
    FROM curricula
    WHERE status = 'frozen'
    ORDER BY slug
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit
  LOOP
    v_total := v_total + 1;
    BEGIN
      -- 1) Pricing tier exists
      SELECT EXISTS(
        SELECT 1 FROM product_price_tiers
        WHERE product_id = v_bundle_id AND curriculum_id = cur.id
      ) INTO v_has_pricing;

      IF NOT v_has_pricing THEN
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'slug', cur.slug,
          'curriculum_id', cur.id,
          'step', 'pricing',
          'error', 'no product_price_tiers row for bundle'
        );
        CONTINUE;
      END IF;

      -- 2) Grant access
      v_grant_id := grant_learner_course_access(
        v_test_user, cur.id, v_bundle_id, NULL, NULL, NULL
      );
      IF v_grant_id IS NULL THEN
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'slug', cur.slug,
          'curriculum_id', cur.id,
          'step', 'grant',
          'error', 'grant_learner_course_access returned NULL'
        );
        CONTINUE;
      END IF;

      -- 3) Tutor access check
      v_gate := tutor_access_check(cur.id, 200, v_test_user);
      IF (v_gate->>'allowed')::boolean IS NOT TRUE THEN
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'slug', cur.slug,
          'curriculum_id', cur.id,
          'step', 'tutor_gate',
          'error', COALESCE(v_gate->>'reason', 'tutor blocked'),
          'gate', v_gate
        );
      ELSE
        v_passed := v_passed + 1;
      END IF;

      -- 4) Cleanup grant (always)
      DELETE FROM learner_course_grants WHERE id = v_grant_id;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'slug', cur.slug,
        'curriculum_id', cur.id,
        'step', 'exception',
        'error', SQLERRM
      );
      -- Best-effort cleanup if grant was created before exception
      IF v_grant_id IS NOT NULL THEN
        BEGIN
          DELETE FROM learner_course_grants WHERE id = v_grant_id;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END;
    v_grant_id := NULL;
  END LOOP;

  -- ============================================================
  -- CLEANUP VERIFICATION: ensure no leftover grants for test user
  -- ============================================================
  SELECT count(*)::int INTO v_leftover
  FROM learner_course_grants
  WHERE user_id = v_test_user;

  v_cleanup_ok := (v_leftover = 0);

  IF NOT v_cleanup_ok THEN
    v_failed := v_failed + 1;
    v_failures := v_failures || jsonb_build_object(
      'slug', NULL,
      'curriculum_id', NULL,
      'step', 'cleanup_verification',
      'error', format('leftover grants for test user: %s', v_leftover),
      'leftover_grants', v_leftover
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', v_failed = 0,
    'phase', CASE WHEN NOT v_cleanup_ok THEN 'cleanup_verification' ELSE 'complete' END,
    'assertions', v_assertions,
    'total', v_total,
    'passed', v_passed,
    'failed', v_failed,
    'failures', v_failures,
    'cleanup_verified', v_cleanup_ok,
    'leftover_grants', v_leftover,
    'cleanup_checked_at', now(),
    'test_user_id', v_test_user,
    'started_at', v_started_at,
    'finished_at', now()
  );
END;
$$;