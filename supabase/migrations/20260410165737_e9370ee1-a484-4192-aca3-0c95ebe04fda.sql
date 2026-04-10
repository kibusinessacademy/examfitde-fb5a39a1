
-- Guard 1: Failed-step-with-completed-job-explosion detector & healer
-- Guard 2: Stale-lock-rotation-without-progress detector & killer

CREATE OR REPLACE FUNCTION fn_guard_reconciler_explosion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  healed_count INT := 0;
BEGIN
  -- Guard 1: step=failed but many completed jobs in last 6h
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
    -- Heal: reset step to queued
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

    -- Notify
    INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
    SELECT
      'Reconciler-Explosion erkannt: ' || rec.step_key,
      'Step "' || rec.step_key || '" war failed, aber ' || rec.completed_jobs || 
      ' completed Jobs in 6h. Step auf queued geheilt. Package: ' || cp.title,
      'warning', 'pipeline', 'package', rec.package_id::text
    FROM course_packages cp WHERE cp.id = rec.package_id
    AND NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE entity_id = rec.package_id::text
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
$$;

-- Guard 2: Stale-lock rotation killer
CREATE OR REPLACE FUNCTION fn_guard_stale_lock_rotation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- Kill the rotating job
    UPDATE job_queue
    SET status = 'failed',
        last_error = 'STALE_LOCK_ROTATION_GUARD: killed after ' || rec.attempts || ' attempts without progress',
        updated_at = NOW()
    WHERE id = rec.job_id
      AND status = 'processing';

    -- Flag associated step
    UPDATE package_steps
    SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_lock_rotation_killed', true,
          'killed_job_id', rec.job_id,
          'killed_at', NOW()
        ),
        updated_at = NOW()
    WHERE package_id = rec.package_id
      AND step_key = REPLACE(rec.job_type, 'package_', '');

    -- Notify (deduplicated)
    INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
    SELECT
      'Stale-Lock-Rotation gestoppt: ' || rec.job_type,
      'Job ' || rec.job_id || ' rotierte ' || rec.attempts || 'x mit STALE_LOCK_RECOVERY ohne Fortschritt. Terminiert.',
      'critical', 'pipeline', 'package', rec.package_id::text
    WHERE NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE entity_id = rec.package_id::text
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
$$;

-- Cron: run both guards every 10 minutes
SELECT cron.schedule('guard-reconciler-explosion', '*/10 * * * *',
  $$SELECT fn_guard_reconciler_explosion()$$);

SELECT cron.schedule('guard-stale-lock-rotation', '*/10 * * * *',
  $$SELECT fn_guard_stale_lock_rotation()$$);
