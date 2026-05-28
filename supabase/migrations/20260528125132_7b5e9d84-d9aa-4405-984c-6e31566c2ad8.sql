CREATE OR REPLACE FUNCTION public.verwaltung_executive_cockpit(_window_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := COALESCE(auth.role(),'');
  v_exec jsonb;
  v_risks jsonb;
  v_reality jsonb;
  v_pressure jsonb;
BEGIN
  IF v_role <> 'service_role'
     AND (v_uid IS NULL OR NOT public.has_role(v_uid, 'admin')) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  v_exec     := public.verwaltung_daily_brief_executive(_window_days);
  v_risks    := public.verwaltung_daily_brief_governance_risks(_window_days);
  v_reality  := public.verwaltung_daily_brief_reality_bridge(_window_days, 12);
  v_pressure := public.verwaltung_daily_brief_workflow_pressure(_window_days);

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'executive', v_exec,
    'risks', v_risks,
    'reality', v_reality,
    'workflow_pressure', v_pressure
  );
END;
$function$;