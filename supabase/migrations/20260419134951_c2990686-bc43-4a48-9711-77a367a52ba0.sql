
-- ═══════════════════════════════════════════════════════════════════════
-- BUG B FIX: Stale-Lock-Trigger härten — kein Hard-Kill für nie gestartete Jobs
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_guard_stale_lock_loop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recovery_count integer;
BEGIN
  IF NEW.status NOT IN ('pending', 'processing') THEN
    RETURN NEW;
  END IF;

  IF NEW.last_error IS NULL OR NEW.last_error::text NOT ILIKE '%STALE_LOCK_RECOVERY%' THEN
    RETURN NEW;
  END IF;

  -- HARDENING (Bug B): Nie-gestartete Jobs dürfen nie hard-killed werden.
  -- Wenn started_at NULL ist, war der Job nie wirklich beim Worker.
  -- In dem Fall: status -> pending zurück, recovery counter NICHT erhöhen,
  -- last_error markieren als NEVER_PICKED_UP.
  IF NEW.started_at IS NULL THEN
    NEW.status := 'pending';
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.last_error := 'NEVER_PICKED_UP: job lease cleared without execution; recovery counter not incremented';
    NEW.updated_at := now();

    -- Forensisches Log nur einmalig pro Job
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'stale_lock_never_picked_up',
      'trg_guard_stale_lock_loop',
      'job_queue',
      NEW.id::text,
      'detected',
      'Job lease was cleared without execution — recovery counter blocked',
      jsonb_build_object('job_type', NEW.job_type, 'package_id', NEW.package_id)
    );

    RETURN NEW;
  END IF;

  v_recovery_count := COALESCE(NEW.attempts, 0);

  -- Level 3: Hard kill at >= 5 recoveries (NUR für tatsächlich gelaufene Jobs)
  IF v_recovery_count >= 5 THEN
    NEW.status := 'failed';
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.last_error := format(
      'STALE_LOCK_LOOP_HARD_KILL: %s recovery cycles without completion. Auto-terminated by guard trigger.',
      v_recovery_count
    );
    NEW.updated_at := now();

    UPDATE course_packages
    SET stuck_reason = format(
      'Stale-lock loop: job %s (%s) killed after %s recoveries — review required',
      NEW.id, NEW.job_type, v_recovery_count
    )
    WHERE id = NEW.package_id
      AND (stuck_reason IS NULL OR stuck_reason = '');

    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      format('🔒 STALE_LOCK HARD KILL: %s', NEW.job_type),
      format('Job %s wurde nach %s STALE_LOCK_RECOVERY Zyklen terminiert. Package: %s. Manuelle Prüfung erforderlich.',
        left(NEW.id::text, 8), v_recovery_count, left(COALESCE(NEW.package_id::text, 'n/a'), 8)),
      'ops',
      'critical',
      'job_queue',
      NEW.id,
      jsonb_build_object(
        'kind', 'stale_lock_hard_kill',
        'job_type', NEW.job_type,
        'attempts', v_recovery_count,
        'package_id', NEW.package_id,
        'started_at', NEW.started_at
      )
    );

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'stale_lock_hard_kill',
      'trg_guard_stale_lock_loop',
      'job_queue',
      NEW.id::text,
      'applied',
      format('Hard-killed after %s STALE_LOCK_RECOVERY cycles (started_at=%s)', v_recovery_count, NEW.started_at),
      jsonb_build_object('job_type', NEW.job_type, 'package_id', NEW.package_id, 'attempts', v_recovery_count)
    );

    RETURN NEW;
  END IF;

  -- Level 2: Alert at >= 3 recoveries
  IF v_recovery_count >= 3 THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE entity_id = NEW.id
        AND metadata->>'kind' = 'stale_lock_warning'
        AND created_at > now() - interval '2 hours'
    ) THEN
      INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        format('⚠️ STALE_LOCK Warning: %s', NEW.job_type),
        format('Job %s hat %s STALE_LOCK_RECOVERY Zyklen. Hard-Kill bei 5.',
          left(NEW.id::text, 8), v_recovery_count),
        'ops',
        'warning',
        'job_queue',
        NEW.id,
        jsonb_build_object(
          'kind', 'stale_lock_warning',
          'job_type', NEW.job_type,
          'attempts', v_recovery_count,
          'package_id', NEW.package_id
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- BUG C FIX: Step-Job-Coupling-Heal Funktion
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_heal_step_job_coupling(
  _step_keys text[] DEFAULT ARRAY['build_ai_tutor_index','validate_tutor_index','generate_oral_exam','validate_oral_exam','validate_learning_content','validate_exam_pool']
)
RETURNS TABLE(package_id uuid, step_key text, job_type text, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_to_job jsonb := '{
    "build_ai_tutor_index": "package_build_ai_tutor_index",
    "validate_tutor_index": "package_validate_tutor_index",
    "generate_oral_exam": "package_generate_oral_exam",
    "validate_oral_exam": "package_validate_oral_exam",
    "validate_learning_content": "package_validate_learning_content",
    "validate_exam_pool": "package_validate_exam_pool",
    "generate_learning_content": "package_generate_learning_content",
    "finalize_learning_content": "package_finalize_learning_content"
  }'::jsonb;
  r RECORD;
  v_jt text;
BEGIN
  FOR r IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND ps.step_key = ANY(_step_keys)
      AND cp.status IN ('building','blocked')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = (v_step_to_job->>ps.step_key)
          AND jq.status IN ('pending','queued','processing','running','batch_pending')
      )
  LOOP
    v_jt := v_step_to_job->>r.step_key;
    IF v_jt IS NULL THEN CONTINUE; END IF;

    INSERT INTO job_queue (job_type, payload, status, max_attempts, priority, lane, package_id, meta)
    VALUES (
      v_jt,
      jsonb_build_object('package_id', r.package_id, 'curriculum_id', r.curriculum_id, 'step_key', r.step_key),
      'pending', 8, 5,
      CASE WHEN v_jt LIKE 'package_validate_%' THEN 'control' ELSE 'build' END,
      r.package_id,
      jsonb_build_object(
        'source', 'admin_heal_step_job_coupling',
        'reason', 'queued_step_without_active_job',
        'created_at', now()
      )
    );

    package_id := r.package_id; step_key := r.step_key; job_type := v_jt; action := 'enqueued';
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- FORENSIK-VIEW: failed-no-start
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_ops_failed_no_start_jobs_24h AS
SELECT
  job_type,
  COUNT(*) AS cnt,
  COUNT(*) FILTER (WHERE last_error IS NULL OR btrim(last_error)='') AS empty_err,
  COUNT(*) FILTER (WHERE last_error ILIKE '%STALE_LOCK_LOOP_HARD_KILL%') AS hard_kill_err,
  COUNT(*) FILTER (WHERE (meta->>'stale_lock_recoveries')::int > 0) AS inflated_recoveries,
  MAX(updated_at) AS last_seen
FROM public.job_queue
WHERE status = 'failed'
  AND started_at IS NULL
  AND created_at > now() - interval '24 hours'
GROUP BY job_type
ORDER BY cnt DESC;

GRANT SELECT ON public.v_ops_failed_no_start_jobs_24h TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_heal_step_job_coupling(text[]) TO service_role;
