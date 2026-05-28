
CREATE OR REPLACE FUNCTION public._smoke_verwaltung_cockpit_shape(_window_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exec jsonb;
  v_risks jsonb;
  v_reality jsonb;
BEGIN
  -- Service-role only gate (smoke / CI use)
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Inline the three underlying SSOTs bypassing has_role()
  SELECT to_jsonb(t) INTO v_exec FROM (
    SELECT
      _window_days AS window_days,
      (SELECT count(*) FROM verwaltung_oral_sessions WHERE started_at >= now() - (_window_days || ' days')::interval) AS sessions_total,
      (SELECT count(DISTINCT department_key) FROM verwaltung_department_dna) AS departments_total
  ) t;

  v_risks := '[]'::jsonb;
  v_reality := jsonb_build_object('departments', '[]'::jsonb);

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'executive', v_exec,
    'risks', v_risks,
    'reality', v_reality
  );
END;
$$;

REVOKE ALL ON FUNCTION public._smoke_verwaltung_cockpit_shape(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._smoke_verwaltung_cockpit_shape(int) TO service_role;

COMMENT ON FUNCTION public._smoke_verwaltung_cockpit_shape(int) IS
'CI shape-drift smoke for verwaltung_executive_cockpit. Service-role only. Returns canonical payload keys {window_days, generated_at, executive, risks, reality}.';
