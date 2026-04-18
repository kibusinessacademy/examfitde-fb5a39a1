-- Bypass-Heal aller STALE_LOCK_LOOP_HARD_KILL Jobs
-- Pattern: Job killen → Step zurück auf queued (Meta-Cleanse) → frischen Recovery-Job enqueuen

DO $$
DECLARE
  v_job record;
  v_step_key text;
  v_curriculum_id uuid;
  v_healed int := 0;
BEGIN
  FOR v_job IN
    SELECT jq.id as job_id, jq.package_id, jq.job_type,
           cp.curriculum_id, cp.title
    FROM job_queue jq
    JOIN course_packages cp ON cp.id = jq.package_id
    WHERE jq.status = 'failed'
      AND jq.last_error ILIKE '%STALE_LOCK_LOOP_HARD_KILL%'
  LOOP
    v_step_key := REPLACE(v_job.job_type, 'package_', '');

    -- 1) Step Meta-Cleanse + auf queued (außer schon done)
    UPDATE package_steps
    SET status = CASE WHEN status = 'done' THEN status ELSE 'queued' END,
        last_error = format('BYPASS_HEAL_STALE_LOCK_HARD_KILL:reset_at=%s', now()::text),
        meta = COALESCE(meta,'{}'::jsonb) - 'reason_codes'
          || jsonb_build_object(
               'guard_state','recovering',
               'consecutive_no_progress',0,
               'stall_reason_code','BYPASS_HEAL_STALE_LOCK_HARD_KILL',
               'bypass_healed_at', now()::text,
               'last_guard_action','admin_bypass_heal_hard_kill'
             ),
        updated_at = now()
    WHERE package_id = v_job.package_id
      AND step_key = v_step_key
      AND status NOT IN ('done','skipped');

    -- 2) Stuck-Reason am Paket bereinigen (falls gesetzt)
    UPDATE course_packages
    SET stuck_reason = NULL, updated_at = now()
    WHERE id = v_job.package_id
      AND stuck_reason ILIKE '%stale%lock%';

    -- 3) Alte Jobs für selben Step bereinigen
    UPDATE job_queue
    SET status = 'cancelled',
        completed_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancel_reason','admin_bypass_heal_hard_kill'),
        updated_at = now()
    WHERE package_id = v_job.package_id
      AND job_type = v_job.job_type
      AND status IN ('pending','queued','processing','failed')
      AND id <> v_job.job_id;

    -- 4) Job selbst final als cancelled markieren (überschreibt failed)
    UPDATE job_queue
    SET status = 'cancelled',
        completed_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancel_reason','admin_bypass_heal_hard_kill','superseded',true),
        updated_at = now()
    WHERE id = v_job.job_id;

    -- 5) Frischen Recovery-Job
    INSERT INTO job_queue (package_id, job_type, status, priority, payload, created_at, lane, attempts, max_attempts)
    VALUES (
      v_job.package_id,
      v_job.job_type,
      'pending',
      5,
      jsonb_build_object(
        'source','admin_bypass_heal_stale_lock_hard_kill',
        'curriculum_id', v_job.curriculum_id,
        'is_repair', true,
        'reset_attempts', true
      ),
      now(),
      'recovery',
      0,
      8
    );

    v_healed := v_healed + 1;

    INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
    VALUES (
      'admin_bypass_heal_stale_lock_hard_kill',
      v_step_key,
      jsonb_build_object(
        'package_id', v_job.package_id,
        'title', v_job.title,
        'job_type', v_job.job_type,
        'killed_job_id', v_job.job_id,
        'reason','STALE_LOCK_LOOP_HARD_KILL_bypass_heal'
      ),
      ARRAY[v_job.package_id::text],
      now()
    );
  END LOOP;

  RAISE NOTICE 'Bypass-Healed % STALE_LOCK_LOOP_HARD_KILL jobs', v_healed;
END $$;