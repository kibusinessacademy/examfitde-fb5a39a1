-- P0-5: Integrity Staleness Debounce
-- Prevents requeue storms during mass exam_questions updates.
-- Only requeues if no pending/queued integrity check job exists for the package.

CREATE OR REPLACE FUNCTION fn_detect_integrity_staleness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg record;
  new_hash text;
  cid uuid;
  has_active_check boolean;
BEGIN
  -- Statement-level trigger: NEW/OLD may be NULL on DELETE
  -- For statement-level triggers on exam_questions, we need to handle all affected curricula
  -- Use a simpler approach: scan all building packages with stale hashes
  
  FOR pkg IN
    SELECT cp.id, cp.exam_pool_state_hash, cp.curriculum_id
    FROM course_packages cp
    WHERE cp.status IN ('building', 'blocked', 'quality_gate_failed')
      AND cp.integrity_passed = true
      AND cp.exam_pool_state_hash IS NOT NULL
  LOOP
    new_hash := fn_compute_exam_pool_hash(pkg.curriculum_id);
    
    IF pkg.exam_pool_state_hash IS NOT DISTINCT FROM new_hash THEN
      CONTINUE; -- no drift
    END IF;

    -- DEBOUNCE: skip if there's already an active integrity check job
    SELECT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = pkg.id
        AND jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending', 'queued', 'processing')
    ) INTO has_active_check;

    IF has_active_check THEN
      -- Just update the hash, don't requeue
      UPDATE course_packages
      SET exam_pool_state_hash = new_hash, updated_at = now()
      WHERE id = pkg.id;
      CONTINUE;
    END IF;

    -- DEBOUNCE: skip if integrity step was requeued in the last 5 minutes
    IF EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = pkg.id
        AND ps.step_key = 'run_integrity_check'
        AND ps.status = 'queued'
        AND (ps.meta->>'staleness_requeue_at')::timestamptz > now() - interval '5 minutes'
    ) THEN
      UPDATE course_packages
      SET exam_pool_state_hash = new_hash, updated_at = now()
      WHERE id = pkg.id;
      CONTINUE;
    END IF;

    -- Real drift detected, no active check → invalidate + requeue
    UPDATE course_packages
    SET integrity_passed = false,
        exam_pool_state_hash = new_hash,
        updated_at = now()
    WHERE id = pkg.id;

    UPDATE package_steps
    SET status = 'queued',
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'staleness_requeue_at', now()::text,
          'reason', 'exam_pool_state_drift'
        )
    WHERE package_id = pkg.id
      AND step_key = 'run_integrity_check'
      AND status = 'done';

    INSERT INTO admin_notifications (
      title, body, category, severity, entity_type, entity_id, metadata
    ) VALUES (
      'INTEGRITY_STALENESS_DETECTED',
      format('Package %s integrity invalidated: exam pool hash drifted.', pkg.id),
      'ops', 'warn', 'package', pkg.id,
      jsonb_build_object('old_hash', pkg.exam_pool_state_hash, 'new_hash', new_hash)
    );
  END LOOP;

  RETURN NULL;
END;
$$;