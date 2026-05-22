
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('terminal_drift_reconciled', ARRAY['job_id','package_id','job_type','attempts','max_attempts'], 'ops/job_queue'),
  ('terminal_drift_reconcile_noop', ARRAY['scanned_at'], 'ops/job_queue'),
  ('terminal_drift_insert_blocked', ARRAY['attempted_job_type','attempts','max_attempts'], 'ops/job_queue')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_job_queue_terminal_drift AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  jq.package_id,
  jq.attempts,
  jq.max_attempts,
  jq.status,
  jq.locked_at,
  jq.last_error,
  jq.created_at,
  jq.updated_at,
  EXTRACT(EPOCH FROM (now() - jq.created_at))/3600.0 AS age_hours
FROM public.job_queue jq
WHERE jq.status = 'pending'
  AND jq.attempts >= jq.max_attempts
  AND jq.locked_at IS NULL;

REVOKE ALL ON public.v_job_queue_terminal_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_job_queue_terminal_drift TO service_role;

CREATE OR REPLACE FUNCTION public.fn_reconcile_terminal_drift_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_count int := 0;
  v_scan_id uuid := gen_random_uuid();
BEGIN
  FOR v_rec IN
    SELECT id, job_type, package_id, attempts, max_attempts
    FROM public.job_queue
    WHERE status = 'pending'
      AND attempts >= max_attempts
      AND locked_at IS NULL
    LIMIT 200
  LOOP
    UPDATE public.job_queue
    SET status = 'failed',
        last_error = COALESCE(last_error, '') || ' | RECONCILED: terminal_drift_attempts_exhausted',
        updated_at = now()
    WHERE id = v_rec.id;

    PERFORM public.fn_emit_audit(
      'terminal_drift_reconciled',
      jsonb_build_object(
        'job_id', v_rec.id,
        'package_id', v_rec.package_id,
        'job_type', v_rec.job_type,
        'attempts', v_rec.attempts,
        'max_attempts', v_rec.max_attempts,
        'scan_id', v_scan_id
      ),
      'job',
      v_rec.id::text,
      'success'
    );

    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    PERFORM public.fn_emit_audit(
      'terminal_drift_reconcile_noop',
      jsonb_build_object('scanned_at', now(), 'scan_id', v_scan_id),
      'system',
      'terminal_drift_reconciler',
      'noop'
    );
  END IF;

  RETURN jsonb_build_object('reconciled', v_count, 'scan_id', v_scan_id);
END
$$;

REVOKE ALL ON FUNCTION public.fn_reconcile_terminal_drift_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_terminal_drift_jobs() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_job_queue_no_exhausted_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending'
     AND NEW.attempts IS NOT NULL
     AND NEW.max_attempts IS NOT NULL
     AND NEW.attempts >= NEW.max_attempts THEN

    BEGIN
      PERFORM public.fn_emit_audit(
        'terminal_drift_insert_blocked',
        jsonb_build_object(
          'attempted_job_type', NEW.job_type,
          'attempts', NEW.attempts,
          'max_attempts', NEW.max_attempts,
          'package_id', NEW.package_id,
          'payload_summary', left(COALESCE(NEW.payload::text,''), 500)
        ),
        'job',
        COALESCE(NEW.id::text, 'pre_insert'),
        'blocked'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    NEW.status := 'failed';
    NEW.last_error := COALESCE(NEW.last_error,'') || ' | BLOCKED: terminal_drift_at_insert';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_job_queue_no_exhausted_insert ON public.job_queue;
CREATE TRIGGER trg_guard_job_queue_no_exhausted_insert
BEFORE INSERT ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_job_queue_no_exhausted_insert();
