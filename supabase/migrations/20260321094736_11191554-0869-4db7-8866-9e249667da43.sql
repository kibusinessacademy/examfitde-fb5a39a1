-- Fix build_progress trigger to exclude phantom/skipped steps from denominator
-- Progress should be: done_functional / total_functional * 100
-- Where "functional" means step_key is in the 25 SSOT backbone
CREATE OR REPLACE FUNCTION public.fn_sync_package_build_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_done int;
  v_pct int;
BEGIN
  -- Count only functional (non-skipped) steps for progress
  -- Skipped steps are phantom/legacy and should not inflate progress
  SELECT 
    COUNT(*) FILTER (WHERE status != 'skipped'),
    COUNT(*) FILTER (WHERE status = 'done')
  INTO v_total, v_done
  FROM public.package_steps
  WHERE package_id = NEW.package_id;

  v_pct := CASE WHEN v_total > 0 THEN ROUND(v_done * 100.0 / v_total) ELSE 0 END;

  UPDATE public.course_packages
  SET build_progress = v_pct, updated_at = now()
  WHERE id = NEW.package_id
    AND build_progress IS DISTINCT FROM v_pct;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';