CREATE OR REPLACE FUNCTION public.admin_step_reset_detailed(
  p_package_id uuid,
  p_step_keys text[],
  p_reason text,
  p_source text DEFAULT NULL,
  p_nudge_atomic boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_nudge_result jsonb := NULL;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  v_result := public.admin_step_reset_detailed(
    p_package_id       := p_package_id,
    p_step_keys        := p_step_keys,
    p_reason           := p_reason,
    p_operator         := COALESCE(p_source, 'compat_step_reset'),
    p_allow_regression := true,
    p_clear_exhaustion := true
  );

  IF COALESCE(p_nudge_atomic, false) THEN
    BEGIN
      v_nudge_result := public.admin_nudge_atomic_trigger(p_package_id, false);
    EXCEPTION WHEN OTHERS THEN
      v_nudge_result := jsonb_build_object(
        'ok', false,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END IF;

  RETURN v_result || jsonb_build_object(
    'compat_signature', true,
    'source', p_source,
    'nudge_atomic_requested', COALESCE(p_nudge_atomic, false),
    'nudge_result', v_nudge_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';