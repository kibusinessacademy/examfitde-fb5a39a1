
DROP FUNCTION IF EXISTS public.enforce_priority_gate();

CREATE OR REPLACE FUNCTION public.enforce_priority_gate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ceiling integer;
  v_demoted integer := 0;
BEGIN
  v_ceiling := get_priority_ceiling();
  
  IF v_ceiling < 100 THEN
    UPDATE course_packages
    SET status = 'queued', current_step = 0, updated_at = now()
    WHERE status = 'building'
      AND priority > v_ceiling
      AND build_progress < 10
      AND updated_at < now() - interval '10 minutes'
      AND id NOT IN (
        SELECT target_id::uuid FROM auto_heal_log
        WHERE action_type = 'recover_and_reenter_package'
          AND result_status = 'success'
          AND created_at > now() - interval '15 minutes'
      );
    
    GET DIAGNOSTICS v_demoted = ROW_COUNT;
    
    IF v_demoted > 0 THEN
      UPDATE job_queue
      SET status = 'cancelled',
          last_error = 'enforce_priority_gate: package demoted (priority > ceiling ' || v_ceiling || ')',
          completed_at = now()
      WHERE status IN ('pending', 'processing')
        AND package_id IN (
          SELECT id FROM course_packages
          WHERE status = 'queued' AND current_step = 0
            AND updated_at > now() - interval '1 minute'
        );
        
      INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
      VALUES ('enforce_priority_gate', 'cron', 'applied',
        v_demoted || ' packages demoted (ceiling=' || v_ceiling || ')',
        jsonb_build_object('ceiling', v_ceiling, 'demoted', v_demoted));
    END IF;
  END IF;
END;
$$;
