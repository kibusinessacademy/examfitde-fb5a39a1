DROP FUNCTION IF EXISTS public.admin_force_steps_done(uuid, text[], text);
DROP FUNCTION IF EXISTS public.admin_force_steps_done(uuid, text[], text, boolean);

CREATE FUNCTION public.admin_force_steps_done(
  p_package_id uuid,
  p_step_keys text[],
  p_reason text DEFAULT 'manual_admin_backfill'::text
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.admin_force_steps_done(p_package_id, p_step_keys, p_reason, false, false);
$$;

CREATE FUNCTION public.admin_force_steps_done(
  p_package_id uuid,
  p_step_keys text[],
  p_reason text,
  p_emergency_bypass boolean
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.admin_force_steps_done(p_package_id, p_step_keys, p_reason, p_emergency_bypass, false);
$$;

INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES ('admin_force_steps_done_overload_consolidated','migration','system','system','ok',
        '3-arg + 4-arg variants now delegate to canonical 5-arg variant',
        jsonb_build_object('sqlstate_fixed','42725','prev_cluster','phantom_cleanup_published_failed'));