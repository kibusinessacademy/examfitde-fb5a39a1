CREATE OR REPLACE FUNCTION public.fn_is_bronze_locked(p_package_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM course_packages
    WHERE id = p_package_id
      AND (
        COALESCE((feature_flags->'bronze'->>'requires_review')::boolean, false) = true
        OR COALESCE((feature_flags->'bronze'->>'repair_attempts')::int, 0) >= 1
        OR (feature_flags->'bronze'->>'final_state') IN ('requires_review','manual_review_required')
        OR COALESCE((feature_flags->'bronze_quarantine'->>'active')::boolean, false) = true
        OR COALESCE((feature_flags->'pre_heartbeat_quarantine'->>'active')::boolean, false) = true
        OR COALESCE((feature_flags->'bronze'->>'locked')::boolean, false) = true
      )
      AND NOT (feature_flags ? 'admin_force_building_at')
      AND COALESCE((feature_flags->'bronze'->>'manual_bypass')::boolean,false) = false
      AND COALESCE((feature_flags->'bronze_quarantine'->>'manual_bypass')::boolean,false) = false
      AND COALESCE((feature_flags->'pre_heartbeat_quarantine'->>'manual_bypass')::boolean,false) = false
  );
$function$;

INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
SELECT
  'bronze_lock_ssot_repair',
  'migration',
  'system',
  'fn_is_bronze_locked',
  'applied',
  'Added bronze.locked=true branch to fn_is_bronze_locked',
  jsonb_build_object(
    'fix','A',
    'total_locked_after',(SELECT count(*) FROM course_packages WHERE public.fn_is_bronze_locked(id)=true)
  );