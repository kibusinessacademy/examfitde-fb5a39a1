
CREATE OR REPLACE FUNCTION public.admin_publish_readiness_batch(p_package_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_results jsonb := '{}'::jsonb;
  v_id uuid;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_required');
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'results', '{}'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY p_package_ids LOOP
    v_results := v_results || jsonb_build_object(v_id::text,
      public.admin_check_publish_readiness(v_id)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_publish_readiness_batch(uuid[]) TO authenticated, service_role;
