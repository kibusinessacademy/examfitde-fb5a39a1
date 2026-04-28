CREATE OR REPLACE FUNCTION public.admin_e2e_run_bundle_check(
  p_test_user_id uuid,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle_id uuid;
  v_bundle_active boolean;
  v_lc_active boolean;
  v_et_active boolean;
  v_active_count int;
  v_passed int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_assertions jsonb := '{}'::jsonb;
  cur RECORD;
  v_grant_id uuid;
  v_gate jsonb;
  v_step text;
  v_tier_count int;
  v_total int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- ── Pre-Flight Product State Assertions ──
  SELECT is_active INTO v_bundle_active FROM store_products WHERE product_key = 'bundle';
  SELECT is_active INTO v_lc_active     FROM store_products WHERE product_key = 'learning_course';
  SELECT is_active INTO v_et_active     FROM store_products WHERE product_key = 'exam_trainer';
  SELECT count(*) INTO v_active_count   FROM store_products WHERE is_active = true;
  SELECT id INTO v_bundle_id FROM store_products WHERE product_key='bundle' AND is_active=true;

  v_assertions := jsonb_build_object(
    'bundle_active',           COALESCE(v_bundle_active, false),
    'learning_course_inactive', v_lc_active IS NOT TRUE,
    'exam_trainer_inactive',    v_et_active IS NOT TRUE,
    'only_bundle_active',       v_active_count = 1
  );

  IF NOT (COALESCE(v_bundle_active,false)
          AND v_lc_active IS NOT TRUE
          AND v_et_active IS NOT TRUE
          AND v_active_count = 1) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'phase', 'pre_flight',
      'assertions', v_assertions,
      'message', 'Product-state assertions failed. Bundle-only invariant violated.'
    );
  END IF;

  -- ── Per-Curriculum E2E ──
  v_total := 0;
  FOR cur IN
    SELECT id, slug FROM curricula
    WHERE status='frozen'
    ORDER BY slug
    OFFSET COALESCE(p_offset,0)
    LIMIT p_limit
  LOOP
    v_total := v_total + 1;
    v_step := 'pricing';
    BEGIN
      SELECT count(*) INTO v_tier_count
        FROM product_price_tiers WHERE product_id = v_bundle_id;
      IF v_tier_count = 0 THEN RAISE EXCEPTION 'no price tiers for bundle'; END IF;

      v_step := 'grant';
      v_grant_id := grant_learner_course_access(p_test_user_id, cur.id, v_bundle_id, NULL, NULL, 'e2e_test');

      v_step := 'tutor_gate';
      v_gate := tutor_access_check(cur.id, 200, p_test_user_id);
      IF (v_gate->>'allowed')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'tutor blocked: %', v_gate->>'reason';
      END IF;

      v_step := 'cleanup';
      DELETE FROM learner_course_grants WHERE id = v_grant_id;

      v_passed := v_passed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'slug', cur.slug,
        'curriculum_id', cur.id,
        'step', v_step,
        'error', SQLERRM
      );
      -- Best-effort cleanup
      IF v_grant_id IS NOT NULL THEN
        DELETE FROM learner_course_grants WHERE id = v_grant_id;
        v_grant_id := NULL;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_failed = 0,
    'phase', 'complete',
    'assertions', v_assertions,
    'total', v_total,
    'passed', v_passed,
    'failed', v_failed,
    'failures', v_failures
  );
END;
$$;