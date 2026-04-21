-- ============================================================
-- P0: Job-Step-Coherence Guard (Phase 2 of cancel-loop-elimination)
-- Extends trg_cancel_orphan_jobs_on_step_done to cover ALL terminal
-- step states (done, skipped, failed) and ALL non-running job states
-- (pending, queued, enqueued, batch_pending).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_cancel_orphan_jobs_on_step_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job_types text[];
  v_cancelled int;
BEGIN
  -- Fire only on transition INTO a terminal step status
  IF NEW.status NOT IN ('done','skipped','failed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT job_types INTO v_job_types
  FROM step_job_mapping
  WHERE step_key = NEW.step_key;

  IF v_job_types IS NULL OR array_length(v_job_types, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cancel ALL non-running, non-terminal jobs for this step.
  -- IMPORTANT: 'processing' is preserved — runners must finish naturally.
  UPDATE job_queue
  SET status = 'cancelled',
      last_error = 'step_finalized_job_obsoleted',
      completed_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'step_finalized',
        'cancel_source', 'trg_cancel_orphan_jobs_on_step_terminal',
        'step_key', NEW.step_key,
        'step_terminal_status', NEW.status::text
      )
  WHERE package_id = NEW.package_id
    AND job_type = ANY(v_job_types)
    AND status IN ('pending','queued','enqueued','batch_pending');

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF v_cancelled > 0 THEN
    INSERT INTO auto_heal_log (
      action_type, trigger_source, target_type, target_id,
      result_status, result_detail, metadata
    ) VALUES (
      'cancel_orphan_jobs_on_step_terminal',
      'trg_cancel_orphan_jobs_on_step_terminal',
      'package',
      NEW.package_id,
      'success',
      format('Cancelled %s orphan jobs for step %s (terminal=%s, processing preserved)',
             v_cancelled, NEW.step_key, NEW.status),
      jsonb_build_object(
        'step_key', NEW.step_key,
        'step_terminal_status', NEW.status::text,
        'cancelled_count', v_cancelled,
        'job_types', v_job_types,
        'processing_preserved', true,
        'covered_job_states', ARRAY['pending','queued','enqueued','batch_pending']
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Replace the narrow trigger with the wide one.
DROP TRIGGER IF EXISTS trg_cancel_orphan_jobs_on_step_done ON public.package_steps;
DROP TRIGGER IF EXISTS trg_cancel_orphan_jobs_on_step_terminal ON public.package_steps;

CREATE TRIGGER trg_cancel_orphan_jobs_on_step_terminal
AFTER UPDATE OF status ON public.package_steps
FOR EACH ROW
WHEN (NEW.status IN ('done','skipped','failed')
      AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.fn_cancel_orphan_jobs_on_step_terminal();

-- ============================================================
-- One-shot heal of existing drift
-- ============================================================
WITH drift AS (
  SELECT jq.id
  FROM job_queue jq
  JOIN package_steps ps ON ps.package_id = jq.package_id
  JOIN step_job_mapping sjm ON sjm.step_key = ps.step_key
  WHERE ps.status IN ('done','skipped','failed')
    AND jq.job_type = ANY(sjm.job_types)
    AND jq.status IN ('pending','queued','enqueued','batch_pending')
)
UPDATE job_queue jq
SET status = 'cancelled',
    last_error = 'step_finalized_job_obsoleted',
    completed_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'step_finalized',
      'cancel_source', 'p0_backfill_step_job_coherence',
      'backfill_at', now()
    )
FROM drift
WHERE drift.id = jq.id;