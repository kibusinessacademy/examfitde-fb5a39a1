
-- ═══════════════════════════════════════════════════════════════════
-- CONSOLIDATED TYPE-CAST HARDENING: entity_id UUID drift fix
-- All 5 remaining functions that pass ::text to admin_notifications.entity_id (UUID)
-- ═══════════════════════════════════════════════════════════════════

-- 1. fn_alert_stale_admin_holds
CREATE OR REPLACE FUNCTION public.fn_alert_stale_admin_holds()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT package_id, title, priority, hours_blocked
    FROM v_ops_stale_admin_holds
    WHERE hours_blocked > 48
    AND NOT EXISTS (
      SELECT 1 FROM admin_notifications an
      WHERE an.entity_id = v_ops_stale_admin_holds.package_id
        AND an.category = 'stale_admin_hold'
        AND an.created_at > now() - interval '24 hours'
    )
    LIMIT 10
  LOOP
    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id)
    VALUES (
      format('Stale Admin Hold: %s (Prio %s)', v_rec.title, v_rec.priority),
      format('Package %s is on admin_hold for %.0f hours. Review and release or archive.', v_rec.package_id, v_rec.hours_blocked),
      'stale_admin_hold', 'warning', 'course_package', v_rec.package_id
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- 2. fn_guard_ghost_finalization
CREATE OR REPLACE FUNCTION public.fn_guard_ghost_finalization()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_healed integer := 0;
  v_jobs_cancelled integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT 
      ps.package_id,
      ps.step_key,
      ps.status as step_status,
      ps.started_at as step_started_at,
      max(j.attempts) as max_job_attempts,
      count(j.id) as job_count,
      array_agg(j.id) as job_ids
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    JOIN job_queue j ON j.package_id = ps.package_id
    WHERE cp.status = 'building'
      AND ps.status IN ('running', 'enqueued')
      AND ps.started_at IS NULL
      AND j.status IN ('pending', 'processing', 'failed')
      AND j.attempts >= 3
    GROUP BY ps.package_id, ps.step_key, ps.status, ps.started_at
    HAVING max(j.attempts) >= 3
  LOOP
    UPDATE package_steps
    SET 
      status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'ghost_guard_healed_at', now()::text,
        'ghost_max_job_attempts', rec.max_job_attempts,
        'ghost_job_count', rec.job_count
      )
    WHERE package_id = rec.package_id
      AND step_key = rec.step_key;
    
    v_healed := v_healed + 1;

    UPDATE job_queue
    SET 
      status = 'failed',
      last_error = format('GHOST_FINALIZATION_BLOCKED: Step %s never started despite %s job attempts. Auto-cancelled.', 
        rec.step_key, rec.max_job_attempts),
      updated_at = now()
    WHERE id = ANY(rec.job_ids)
      AND status IN ('pending', 'processing');
    
    GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'ghost_finalization_guard',
      'fn_guard_ghost_finalization',
      'package_steps',
      rec.package_id::text,
      'applied',
      format('Step %s reset, %s ghost jobs cancelled (max attempts: %s)', 
        rec.step_key, v_jobs_cancelled, rec.max_job_attempts),
      jsonb_build_object(
        'step_key', rec.step_key,
        'max_job_attempts', rec.max_job_attempts,
        'job_count', rec.job_count,
        'jobs_cancelled', v_jobs_cancelled
      )
    );

    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      format('👻 Ghost-Finalization: %s', rec.step_key),
      format('Step %s (Package %s) hatte %s Jobs mit bis zu %s Attempts aber wurde nie gestartet. Reset auf queued.',
        rec.step_key, left(rec.package_id::text, 8), rec.job_count, rec.max_job_attempts),
      'ops',
      'warning',
      'package',
      rec.package_id,
      jsonb_build_object(
        'kind', 'ghost_finalization_guard',
        'step_key', rec.step_key,
        'max_job_attempts', rec.max_job_attempts
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'steps_healed', v_healed,
    'ran_at', now()::text
  );
END;
$function$;

-- 3. fn_guard_reconciler_explosion
CREATE OR REPLACE FUNCTION public.fn_guard_reconciler_explosion()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  healed_count INT := 0;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, COUNT(*) AS completed_jobs
    FROM package_steps ps
    JOIN job_queue jq ON jq.package_id = ps.package_id
      AND jq.job_type = 'package_' || ps.step_key
      AND jq.status = 'completed'
      AND jq.updated_at >= NOW() - INTERVAL '6 hours'
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'failed'
      AND cp.status = 'building'
    GROUP BY ps.package_id, ps.step_key
    HAVING COUNT(*) >= 5
  LOOP
    UPDATE package_steps
    SET status = 'queued',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'reconciler_explosion_healed', true,
          'explosion_completed_jobs', rec.completed_jobs,
          'healed_at', NOW()
        ),
        updated_at = NOW()
    WHERE package_id = rec.package_id
      AND step_key = rec.step_key
      AND status = 'failed';

    INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
    SELECT
      'Reconciler-Explosion erkannt: ' || rec.step_key,
      'Step "' || rec.step_key || '" war failed, aber ' || rec.completed_jobs || 
      ' completed Jobs in 6h. Step auf queued geheilt. Package: ' || cp.title,
      'warning', 'pipeline', 'package', rec.package_id
    FROM course_packages cp WHERE cp.id = rec.package_id
    AND NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE entity_id = rec.package_id
        AND category = 'pipeline'
        AND title LIKE 'Reconciler-Explosion%' || rec.step_key || '%'
        AND created_at > NOW() - INTERVAL '2 hours'
    );

    healed_count := healed_count + 1;
  END LOOP;

  IF healed_count > 0 THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_type, result_status, result_detail)
    VALUES ('cron_guard', 'reconciler_explosion_heal', 'package_steps', 'success',
      jsonb_build_object('healed_count', healed_count));
  END IF;
END;
$function$;

-- 4. fn_guard_stale_lock_loop
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

  v_recovery_count := COALESCE(NEW.attempts, 0);

  -- Level 3: Hard kill at >= 5 recoveries
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
        'package_id', NEW.package_id
      )
    );

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'stale_lock_hard_kill',
      'trg_guard_stale_lock_loop',
      'job_queue',
      NEW.id::text,
      'applied',
      format('Hard-killed after %s STALE_LOCK_RECOVERY cycles', v_recovery_count),
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
        format('⚠️ Stale-Lock Warning: %s', NEW.job_type),
        format('Job %s hat %s STALE_LOCK_RECOVERY Zyklen. Wird bei 5 automatisch terminiert. Package: %s.',
          left(NEW.id::text, 8), v_recovery_count, left(COALESCE(NEW.package_id::text, 'n/a'), 8)),
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

-- 5. fn_guard_stale_lock_rotation
CREATE OR REPLACE FUNCTION public.fn_guard_stale_lock_rotation()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  killed_count INT := 0;
BEGIN
  FOR rec IN
    SELECT jq.id AS job_id, jq.package_id, jq.job_type, jq.attempts
    FROM job_queue jq
    WHERE jq.status = 'processing'
      AND jq.attempts >= 3
      AND jq.last_error LIKE '%STALE_LOCK_RECOVERY%'
      AND jq.updated_at < NOW() - INTERVAL '30 minutes'
  LOOP
    UPDATE job_queue
    SET status = 'failed',
        last_error = 'STALE_LOCK_ROTATION_GUARD: killed after ' || rec.attempts || ' attempts without progress',
        updated_at = NOW()
    WHERE id = rec.job_id
      AND status = 'processing';

    UPDATE package_steps
    SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_lock_rotation_killed', true,
          'killed_job_id', rec.job_id,
          'killed_at', NOW()
        ),
        updated_at = NOW()
    WHERE package_id = rec.package_id
      AND step_key = REPLACE(rec.job_type, 'package_', '');

    INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
    SELECT
      'Stale-Lock-Rotation gestoppt: ' || rec.job_type,
      'Job ' || rec.job_id || ' rotierte ' || rec.attempts || 'x mit STALE_LOCK_RECOVERY ohne Fortschritt. Terminiert.',
      'critical', 'pipeline', 'package', rec.package_id
    WHERE NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE entity_id = rec.package_id
        AND title LIKE 'Stale-Lock-Rotation%' || rec.job_type || '%'
        AND created_at > NOW() - INTERVAL '2 hours'
    );

    killed_count := killed_count + 1;
  END LOOP;

  IF killed_count > 0 THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_type, result_status, result_detail)
    VALUES ('cron_guard', 'stale_lock_rotation_kill', 'job_queue', 'success',
      jsonb_build_object('killed_count', killed_count));
  END IF;
END;
$function$;
