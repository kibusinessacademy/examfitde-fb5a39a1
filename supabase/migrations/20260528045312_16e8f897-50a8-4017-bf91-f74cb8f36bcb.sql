CREATE OR REPLACE FUNCTION public.verwaltung_executive_cockpit(_window_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exec jsonb;
  v_risks jsonb;
  v_reality jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  v_exec    := public.verwaltung_daily_brief_executive(_window_days);
  v_risks   := public.verwaltung_daily_brief_governance_risks(_window_days);
  v_reality := public.verwaltung_daily_brief_reality_bridge(_window_days, 12);

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'executive', v_exec,
    'risks', v_risks,
    'reality', v_reality
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_executive_cockpit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verwaltung_executive_cockpit(integer) TO authenticated, service_role;