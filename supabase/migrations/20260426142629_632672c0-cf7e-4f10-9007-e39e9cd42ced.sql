
-- ============================================================
-- Fix: Worker zog 0 Jobs trotz 9 fälligen pending Jobs
-- ============================================================
-- Root Cause: claim_pending_jobs_v4 hat strikten DAG-Filter, der
-- depends_on Steps NICHT in (done, skipped) blockt. Mehrere
-- Predecessor-Steps standen auf 'failed' oder 'queued', weil
-- skipped/completed Jobs den Step-Status nicht reconciliert haben.
--
-- Lösungen:
-- 1) Sofort-Reconcile: Steps mit jüngstem completed-Job auf 'done' setzen
--    (bei Skip: 'skipped'), failed-Steps mit completed Nachfolge-Job heilen.
-- 2) Trigger: Job → step_status auto-reconcile bei completed/cancelled-skip.
-- 3) Cron: alle 5 min Drift-Reconcile als Sicherheitsnetz.
-- ============================================================

-- Schritt 1: Reconcile-Funktion
CREATE OR REPLACE FUNCTION public.fn_reconcile_step_status_from_jobs(
  _max_rows int DEFAULT 500
)
RETURNS TABLE(package_id uuid, step_key text, old_status text, new_status text, source_job_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  -- A) Job ist completed UND skipped → Step auf 'skipped'
  -- B) Job ist completed (nicht skipped) → Step auf 'done'
  -- Nur wenn es einen NEUEREN completed-Job gibt als der letzte Step-Übergang
  FOR r IN
    WITH latest_job AS (
      SELECT DISTINCT ON (jq.package_id, jq.job_type)
        jq.package_id,
        replace(jq.job_type, 'package_', '') AS step_key,
        jq.id AS job_id,
        jq.status,
        jq.completed_at,
        COALESCE((jq.meta->>'skipped')::boolean, false) AS is_skip
      FROM job_queue jq
      WHERE jq.status = 'completed'
        AND jq.job_type LIKE 'package_%'
        AND jq.package_id IS NOT NULL
        AND jq.completed_at >= now() - interval '7 days'
      ORDER BY jq.package_id, jq.job_type, jq.completed_at DESC
    )
    SELECT lj.package_id, lj.step_key, ps.status::text AS old_status,
           CASE WHEN lj.is_skip THEN 'skipped' ELSE 'done' END AS new_status,
           lj.job_id
    FROM latest_job lj
    JOIN package_steps ps ON ps.package_id = lj.package_id AND ps.step_key = lj.step_key
    WHERE ps.status NOT IN ('done','skipped')
      AND lj.completed_at > ps.updated_at
    LIMIT _max_rows
  LOOP
    UPDATE package_steps
    SET status = r.new_status::step_status,
        updated_at = now()
    WHERE package_steps.package_id = r.package_id
      AND package_steps.step_key = r.step_key;

    package_id := r.package_id;
    step_key := r.step_key;
    old_status := r.old_status;
    new_status := r.new_status;
    source_job_id := r.job_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reconcile_step_status_from_jobs(int) TO authenticated, service_role;

-- Schritt 2: Trigger auf job_queue UPDATE → bei status=completed direkt reconcilen
CREATE OR REPLACE FUNCTION public.fn_trg_job_complete_reconcile_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_target step_status;
BEGIN
  IF NEW.status <> 'completed' OR (OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;
  IF NEW.job_type IS NULL OR NEW.job_type NOT LIKE 'package_%' OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_step_key := replace(NEW.job_type, 'package_', '');
  v_target := CASE
    WHEN COALESCE((NEW.meta->>'skipped')::boolean, false) THEN 'skipped'::step_status
    ELSE 'done'::step_status
  END;

  UPDATE package_steps
  SET status = v_target, updated_at = now()
  WHERE package_id = NEW.package_id
    AND step_key = v_step_key
    AND status NOT IN ('done','skipped');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_complete_reconcile_step ON public.job_queue;
CREATE TRIGGER trg_job_complete_reconcile_step
  AFTER UPDATE OF status ON public.job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.fn_trg_job_complete_reconcile_step();

-- Schritt 3: Sofort-Reconcile (heilt die hängenden Pakete)
SELECT * FROM public.fn_reconcile_step_status_from_jobs(2000);

-- Schritt 4: Cron alle 5 Min als Safety Net
DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-step-status-from-jobs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reconcile-step-status-from-jobs',
  '*/5 * * * *',
  $$ SELECT public.fn_reconcile_step_status_from_jobs(1000); $$
);
