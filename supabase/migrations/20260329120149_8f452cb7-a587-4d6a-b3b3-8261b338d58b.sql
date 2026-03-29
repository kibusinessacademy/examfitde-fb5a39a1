
-- Fix the pipeline event trigger to use valid event_type values
CREATE OR REPLACE FUNCTION fn_emit_pipeline_event_on_step_change()
RETURNS trigger AS $$
DECLARE
  v_event_type text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Map step status to valid event_type
    v_event_type := CASE NEW.status
      WHEN 'queued' THEN 'retry_scheduled'
      WHEN 'running' THEN 'started'
      WHEN 'done' THEN 'completed'
      WHEN 'failed' THEN 'failed'
      WHEN 'blocked' THEN 'failed'
      WHEN 'skipped' THEN 'skipped'
      ELSE NULL
    END;
    
    IF v_event_type IS NOT NULL THEN
      INSERT INTO course_pipeline_events (package_id, course_id, step_key, event_type, message, created_at)
      VALUES (
        NEW.package_id,
        (SELECT course_id FROM course_packages WHERE id = NEW.package_id),
        NEW.step_key,
        v_event_type,
        'step_' || NEW.step_key || ': ' || OLD.status || ' → ' || NEW.status,
        now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Now reset the steps for Industriemechaniker
UPDATE package_steps 
SET status = 'queued', 
    last_error = NULL, 
    started_at = NULL, 
    finished_at = NULL, 
    last_heartbeat_at = NULL,
    runner_id = NULL,
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
AND step_key = 'run_integrity_check';

UPDATE package_steps 
SET status = 'queued', 
    last_error = NULL, 
    started_at = NULL, 
    finished_at = NULL,
    last_heartbeat_at = NULL,
    runner_id = NULL,
    meta = jsonb_build_object('requeued_reason', 'stale_integrity_report_v16', 'requeued_at', now()::text),
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
AND step_key = 'auto_publish';

-- Unblock package so pipeline-runner picks it up
UPDATE course_packages 
SET status = 'building', 
    blocked_reason = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';
