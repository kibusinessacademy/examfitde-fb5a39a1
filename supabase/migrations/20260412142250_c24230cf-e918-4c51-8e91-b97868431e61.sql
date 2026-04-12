
CREATE OR REPLACE FUNCTION public.fn_test_hollow_guard_regression()
RETURNS TABLE (
  test_name text,
  passed boolean,
  detail jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- TEST 1: No published package with substantive artifacts should be quarantined
  SELECT COUNT(*) INTO v_count
  FROM v_package_hollow_guard_ssot v
  CROSS JOIN LATERAL fn_should_hollow_quarantine_package(v.package_id) d
  WHERE v.status = 'published'
    AND v.has_substantive_artifacts = true
    AND d.should_quarantine = true;

  RETURN QUERY SELECT
    'published_with_artifacts_never_hollow'::text,
    v_count = 0,
    jsonb_build_object('false_positives_found', v_count);

  -- TEST 2: EXAM_FIRST/EXAM_FIRST_PLUS with strong exam pool (>= 100 approved) should never be hollow
  SELECT COUNT(*) INTO v_count
  FROM v_package_hollow_guard_ssot v
  CROSS JOIN LATERAL fn_should_hollow_quarantine_package(v.package_id) d
  WHERE v.status = 'published'
    AND v.track IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS')
    AND v.approved_questions >= 100
    AND d.should_quarantine = true;

  RETURN QUERY SELECT
    'exam_track_with_pool_never_hollow'::text,
    v_count = 0,
    jsonb_build_object('false_positives_found', v_count);

  -- TEST 3: legacy_exempt packages should never be quarantined
  SELECT COUNT(*) INTO v_count
  FROM v_package_hollow_guard_ssot v
  CROSS JOIN LATERAL fn_should_hollow_quarantine_package(v.package_id) d
  WHERE v.legacy_exempt_from_hollow_guard = true
    AND d.should_quarantine = true;

  RETURN QUERY SELECT
    'legacy_exempt_never_quarantined'::text,
    v_count = 0,
    jsonb_build_object('violations_found', v_count);

  -- TEST 4: packages with lessons_real > 0 OR approved_questions >= 10 should not be hollow
  SELECT COUNT(*) INTO v_count
  FROM v_package_hollow_guard_ssot v
  CROSS JOIN LATERAL fn_should_hollow_quarantine_package(v.package_id) d
  WHERE v.status = 'published'
    AND (v.lessons_real > 0 OR v.approved_questions >= 10)
    AND d.should_quarantine = true;

  RETURN QUERY SELECT
    'substantive_content_never_hollow'::text,
    v_count = 0,
    jsonb_build_object('false_positives_found', v_count);
END;
$$;
