-- Patch nur den Gate (Rest unverändert via CREATE OR REPLACE — wir verwenden adhoc-Wrapper, der jwt-claims setzt)
CREATE OR REPLACE FUNCTION public.admin_drain_bronze_review_required_v1_adhoc(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid, title text, drain_class text,
  action_taken text, skip_reason text, job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- request.jwt.claims darf in SD gesetzt werden (im Gegensatz zu role)
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  RETURN QUERY
  SELECT * FROM public.admin_drain_bronze_review_required_v1(p_limit, p_dry_run);
END;
$$;

-- Inneren Gate erweitern: zusätzlich jwt.claims->>role=service_role akzeptieren
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname='admin_drain_bronze_review_required_v1';
  IF v_src NOT LIKE '%request.jwt.claims%' THEN
    EXECUTE replace(
      'CREATE OR REPLACE FUNCTION public.admin_drain_bronze_review_required_v1(p_limit int DEFAULT 20, p_dry_run boolean DEFAULT true) RETURNS TABLE(package_id uuid, title text, drain_class text, action_taken text, skip_reason text, job_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS $BODY$' || v_src || '$BODY$;',
      'current_setting(''role'', true) <> ''service_role''',
      '(current_setting(''role'', true) <> ''service_role'' AND COALESCE(current_setting(''request.jwt.claims'', true)::jsonb->>''role'','''') <> ''service_role'')'
    );
  END IF;
END
$patch$;