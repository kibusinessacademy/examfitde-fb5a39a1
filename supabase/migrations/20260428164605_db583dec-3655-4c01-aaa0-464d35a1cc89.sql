CREATE OR REPLACE FUNCTION public.admin_e2e_run_bundle_check(
  p_test_user_id uuid DEFAULT 'fdb92789-9ce9-40cf-8670-845f04ed267a'::uuid,
  p_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle_id uuid;
  v_price_count int;
  v_total int := 0;
  v_pass int := 0;
  v_fail int := 0;
  v_grant_id uuid;
  v_gate jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_started_at timestamptz := now();
  cur record;
  v_step text;
BEGIN
  -- Admin-Gate
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  -- Bundle product
  SELECT id INTO v_bundle_id FROM store_products WHERE product_key='bundle' AND is_active=true;
  IF v_bundle_id IS NULL THEN
    RAISE EXCEPTION 'bundle product not active';
  END IF;

  -- Pricing existence (global tier)
  SELECT count(*) INTO v_price_count FROM product_price_tiers WHERE product_id=v_bundle_id;
  IF v_price_count = 0 THEN
    RAISE EXCEPTION 'no price tiers for bundle';
  END IF;

  FOR cur IN
    SELECT id, slug FROM curricula WHERE status='frozen' ORDER BY created_at
    LIMIT COALESCE(p_limit, 100000)
  LOOP
    v_total := v_total + 1;
    v_step := 'init';
    BEGIN
      -- Step 1: grant
      v_step := 'grant';
      v_grant_id := public.grant_learner_course_access(
        p_test_user_id,
        cur.id,
        v_bundle_id,
        'e2e_test'::text,
        NULL,
        jsonb_build_object('e2e', true, 'ts', v_started_at)
      );
      IF v_grant_id IS NULL THEN
        RAISE EXCEPTION 'grant returned null';
      END IF;

      -- Step 2: tutor gate
      v_step := 'tutor_gate';
      v_gate := public.tutor_access_check(cur.id, 200, p_test_user_id);
      IF (v_gate->>'allowed')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'tutor not allowed: %', v_gate::text;
      END IF;

      -- Step 3: cleanup
      v_step := 'cleanup';
      DELETE FROM learner_course_grants WHERE id = v_grant_id;

      v_pass := v_pass + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
      v_failures := v_failures || jsonb_build_object(
        'curriculum_id', cur.id,
        'slug', cur.slug,
        'step', v_step,
        'error', SQLERRM
      );
      -- Best-effort cleanup falls grant teilweise erstellt
      IF v_grant_id IS NOT NULL THEN
        BEGIN DELETE FROM learner_course_grants WHERE id = v_grant_id; EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END;
    v_grant_id := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'started_at', v_started_at,
    'finished_at', now(),
    'duration_sec', EXTRACT(EPOCH FROM (now() - v_started_at)),
    'bundle_product_id', v_bundle_id,
    'price_tier_count', v_price_count,
    'total_curricula', v_total,
    'passed', v_pass,
    'failed', v_fail,
    'failures', v_failures
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_e2e_run_bundle_check(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_e2e_run_bundle_check(uuid, integer) TO authenticated;