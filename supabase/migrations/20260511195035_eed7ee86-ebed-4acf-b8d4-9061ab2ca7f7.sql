CREATE OR REPLACE FUNCTION public.fn_tail_heal_package_cooldown_active(p_package_id uuid, p_window interval DEFAULT '00:05:00'::interval)
 RETURNS boolean
 LANGUAGE sql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auto_heal_log l
    WHERE l.metadata->>'package_id' = p_package_id::text
      AND l.action_type IN (
        'queued_tail_reconciler_enqueue',
        'tail_step_drift_v2_heal',
        'tail_step_enqueue_drift_heal'
      )
      AND l.result_status = 'success'
      AND l.created_at > now() - p_window
  );
$function$;