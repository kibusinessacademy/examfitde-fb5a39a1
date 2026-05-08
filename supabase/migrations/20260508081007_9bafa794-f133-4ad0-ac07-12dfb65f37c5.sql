CREATE OR REPLACE FUNCTION public.fn_debounce_integrity_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _recent_count int;
  _is_bronze boolean;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;

  -- Bronze-targeted repair follow-up: bypass debounce (idempotency-key protected)
  _is_bronze := COALESCE(NEW.payload->>'_origin','') = 'bronze_targeted_repair'
             OR COALESCE(NEW.meta->>'enqueue_source','') = 'bronze_targeted_repair'
             OR COALESCE(NEW.meta->>'bronze_repair_followup','') = 'true';
  IF _is_bronze THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _recent_count
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = 'package_run_integrity_check'
    AND created_at > now() - interval '15 minutes'
    AND status IN ('pending', 'processing', 'completed', 'cancelled');

  IF _recent_count > 0 THEN
    RAISE LOG 'DEBOUNCE: Skipping duplicate package_run_integrity_check for package % (% recent)',
      NEW.package_id, _recent_count;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Re-trigger finalize for the 38 packages that were silently debounced.
-- Idempotency-key + bronze bypass will let new jobs through.
DO $$
DECLARE
  r record;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT ON ((metadata->>'package_id')::uuid)
           (metadata->>'package_id')::uuid AS pkg,
           metadata->'summary' AS summary
    FROM auto_heal_log
    WHERE action_type='bronze_repair_finalized'
      AND created_at > now() - interval '6 hours'
      AND (metadata->>'integrity_job_id' IS NULL OR metadata->>'integrity_job_id'='')
    ORDER BY (metadata->>'package_id')::uuid, created_at DESC
  LOOP
    BEGIN
      v_res := public.admin_bronze_repair_finalize(r.pkg, COALESCE(r.summary,'{}'::jsonb));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('manual_replay','bronze_repair_finalize_replay_failed', r.pkg::text,'package','error', SQLERRM,
              jsonb_build_object('package_id', r.pkg));
    END;
  END LOOP;
END $$;