
-- Hardened sync_step_on_job_completion: defensive, no-downgrade, heartbeat update
CREATE OR REPLACE FUNCTION public.sync_step_on_job_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_step_status text;
  v_package_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF (OLD.status IS NOT DISTINCT FROM NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('completed','failed','cancelled') THEN
    RETURN NEW;
  END IF;

  -- Find the step by FK reference (job_id). If no step, do nothing.
  SELECT ps.status::text, ps.package_id
  INTO v_step_status, v_package_id
  FROM public.package_steps ps
  WHERE ps.job_id = NEW.id
  LIMIT 1;

  IF v_step_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- Never downgrade terminal good states
  IF v_step_status IN ('done','skipped') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' THEN
    UPDATE public.package_steps ps
    SET status = 'done',
        updated_at = now()
    WHERE ps.job_id = NEW.id
      AND ps.status::text NOT IN ('done','skipped');

    -- Update package heartbeat
    UPDATE public.course_packages cp
    SET last_progress_at = now(),
        updated_at = now()
    WHERE cp.id = v_package_id;

  ELSE
    -- failed / cancelled => reset step to queued for clean re-enqueue
    UPDATE public.package_steps ps
    SET status = 'queued',
        job_id = NULL,
        updated_at = now()
    WHERE ps.job_id = NEW.id
      AND ps.status::text NOT IN ('done','skipped');

    UPDATE public.course_packages cp
    SET last_progress_at = now(),
        updated_at = now(),
        last_error = left(coalesce(NEW.error, 'Job ' || NEW.status, 'unknown'), 500)
    WHERE cp.id = v_package_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (unchanged)
DROP TRIGGER IF EXISTS trg_sync_step_on_job_completion ON public.job_queue;
CREATE TRIGGER trg_sync_step_on_job_completion
  AFTER UPDATE OF status ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_step_on_job_completion();
