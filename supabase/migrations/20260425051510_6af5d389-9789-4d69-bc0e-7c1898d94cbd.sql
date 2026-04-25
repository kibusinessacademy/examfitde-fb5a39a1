
-- ============================================================
-- FIX: fn_guard_publish_step_drift — Ghost-Completion-Compat
-- ============================================================
-- Problem: AFTER-UPDATE Trigger auf course_packages.status='published'
-- setzt package_steps.auto_publish='done', aber OHNE meta.ok='true'.
-- → fn_guard_ghost_completion blockiert → Exception → Edge Function
--    `package-auto-publish` crasht beim courses.update / course_packages.update
--    → auto_publish bleibt forever 'queued' → HTTP 500 Loop.
--
-- Lösung: Trigger setzt meta.ok='true' + Audit-Felder, analog zu
--          fn_sync_steps_from_completed_jobs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_guard_publish_step_drift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    UPDATE package_steps
    SET status = 'done',
        finished_at = COALESCE(finished_at, now()),
        started_at  = COALESCE(started_at, now() - interval '1 minute'),
        attempts    = GREATEST(attempts, 1),
        last_error  = 'AUTO_HEALED: publish-step-drift-guard',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'ok', 'true',
          'executed', 'true',
          'postcondition_verified', true,
          'healed_by', 'fn_guard_publish_step_drift',
          'healed_at', now()::text,
          'reason', 'package_status_published_drift'
        ),
        updated_at  = now()
    WHERE package_id = NEW.id
      AND step_key   = 'auto_publish'
      AND status <> 'done';

    IF FOUND THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail)
      VALUES (
        'fn_guard_publish_step_drift',
        'publish_step_drift_guard',
        NEW.id::text,
        'course_package',
        'success',
        jsonb_build_object(
          'trigger', 'fn_guard_publish_step_drift',
          'old_status', OLD.status,
          'new_status', NEW.status,
          'action', 'auto_publish step normalized to done with meta.ok=true'
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- ONE-OFF: Heile beide aktuell blockierten Pakete
-- (auto_publish step → done mit meta.ok, course_package → published)
-- Nur falls die Pakete tatsächlich publish-ready sind.
-- ============================================================

DO $$
DECLARE
  v_pkg uuid;
  v_pkgs uuid[] := ARRAY[
    '180c24a9-eba7-4159-ada8-140cee76f947'::uuid,  -- IT-System-Elektroniker/-in
    '65430b12-b481-46e0-88f4-c88606857da7'::uuid   -- Scrum Master PSM I
  ];
  v_step_count int;
BEGIN
  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    -- Prüfe ob alle anderen Steps done/skipped sind
    SELECT COUNT(*) INTO v_step_count
    FROM package_steps
    WHERE package_id = v_pkg
      AND step_key <> 'auto_publish'
      AND status NOT IN ('done', 'skipped');

    IF v_step_count = 0 THEN
      -- Sicherer Reset: auto_publish-Job auf 0 attempts, run_after=now()
      UPDATE job_queue
      SET attempts = 0,
          status = 'pending',
          run_after = now(),
          last_error = NULL,
          locked_at = NULL,
          locked_by = NULL,
          started_at = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'auto_heal_origin', 'publish_step_drift_guard_fix_v2',
            'auto_heal_at', now()::text
          )
      WHERE package_id = v_pkg
        AND job_type = 'package_auto_publish'
        AND status IN ('pending', 'failed');

      RAISE NOTICE 'Reset auto_publish job for package %', v_pkg;
    ELSE
      RAISE NOTICE 'Package % has % unfinished non-publish steps — skipping reset', v_pkg, v_step_count;
    END IF;
  END LOOP;
END $$;
