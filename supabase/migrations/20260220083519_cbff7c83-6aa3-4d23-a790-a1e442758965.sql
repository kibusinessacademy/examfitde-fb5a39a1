-- 1) Trigger: auto-sync package_steps when job_queue reaches terminal state
CREATE OR REPLACE FUNCTION public.sync_step_on_job_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire on terminal transitions
  IF NEW.status IN ('completed','failed','cancelled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    IF NEW.status = 'completed' THEN
      UPDATE public.package_steps
      SET status = 'done',
          finished_at = now(),
          last_heartbeat_at = now()
      WHERE job_id = NEW.id
        AND status::text IN ('enqueued','running');
    ELSE
      -- failed or cancelled: reset to queued for retry
      UPDATE public.package_steps
      SET status = 'queued',
          job_id = NULL,
          runner_id = NULL,
          started_at = NULL,
          last_error = 'Job ' || NEW.status || ': ' || left(coalesce(NEW.last_error,'unknown'), 500)
      WHERE job_id = NEW.id
        AND status::text IN ('enqueued','running');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_step_on_job_completion ON public.job_queue;
CREATE TRIGGER trg_sync_step_on_job_completion
  AFTER UPDATE OF status ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_step_on_job_completion();