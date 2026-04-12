
-- Guard: When a step transitions to 'done', cancel all orphaned jobs for that step
CREATE OR REPLACE FUNCTION public.fn_cancel_orphan_jobs_on_step_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_types text[];
  v_cancelled int;
BEGIN
  -- Only act when status changes TO 'done'
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    -- Look up job types for this step from the SSOT mapping table
    SELECT job_types INTO v_job_types
    FROM step_job_mapping
    WHERE step_key = NEW.step_key;

    -- If no mapping found, nothing to do
    IF v_job_types IS NULL OR array_length(v_job_types, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    -- Cancel all pending/processing jobs of those types for this package
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = 'step_finalized_job_obsoleted',
        completed_at = now()
    WHERE package_id = NEW.package_id
      AND job_type = ANY(v_job_types)
      AND status IN ('pending', 'processing');

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    -- Audit log if any jobs were cancelled
    IF v_cancelled > 0 THEN
      INSERT INTO auto_heal_log (
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'cancel_orphan_jobs_on_step_done',
        'trg_cancel_orphan_jobs_on_step_done',
        'package',
        NEW.package_id,
        'success',
        format('Cancelled %s orphaned jobs for step %s', v_cancelled, NEW.step_key),
        jsonb_build_object(
          'step_key', NEW.step_key,
          'cancelled_count', v_cancelled,
          'job_types', v_job_types
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger fires AFTER update so the step status is already committed
CREATE TRIGGER trg_cancel_orphan_jobs_on_step_done
  AFTER UPDATE OF status ON public.package_steps
  FOR EACH ROW
  WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION public.fn_cancel_orphan_jobs_on_step_done();
