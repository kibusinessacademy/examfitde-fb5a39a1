
DO $$
DECLARE
  phantom_ids uuid[] := ARRAY[
    '10eee221-dd82-4b45-9ffd-e927c1c3c3b2',
    '55edacdf-5230-4e9a-b9c1-dcde00b8cd47',
    '6359dd41-568f-4032-b9eb-8e7e615d44eb',
    '70f0a909-2d44-4b8b-97a3-0aa9679b3704',
    'a02cde5e-a0ad-45fc-a5db-ffe239d387f5',
    'afc4f4fd-e63a-4e7b-a23f-8b78becb87d9',
    'cfa07829-1c64-4a69-8c72-97137591d7fa',
    'd2000000-0003-4000-8000-000000000001',
    'd2000000-0004-4000-8000-000000000001'
  ];
BEGIN
  -- Delete stale council sessions for Buchbinder (old build cycle)
  DELETE FROM council_sessions
  WHERE package_id = '70f0a909-2d44-4b8b-97a3-0aa9679b3704';

  -- Reset integrity
  UPDATE package_steps
  SET status = 'queued',
      meta = jsonb_build_object('note','reset: phantom pass','allow_regression',true,'allow_regression_by','ops_sweep'),
      finished_at = NULL
  WHERE step_key = 'run_integrity_check' AND status = 'done'
    AND package_id = ANY(phantom_ids);

  -- Reset council
  UPDATE package_steps
  SET status = 'queued',
      meta = jsonb_build_object('note','reset: phantom pass council','allow_regression',true,'allow_regression_by','ops_sweep'),
      finished_at = NULL
  WHERE step_key = 'quality_council' AND status = 'done'
    AND package_id = ANY(phantom_ids);

  -- Reset downstream
  UPDATE package_steps
  SET status = 'queued',
      meta = jsonb_build_object('note','reset: downstream phantom','allow_regression',true,'allow_regression_by','ops_sweep'),
      finished_at = NULL
  WHERE step_key IN ('auto_publish','elite_harden') AND status IN ('done','skipped')
    AND package_id = ANY(phantom_ids);

  -- Cancel orphaned jobs
  UPDATE job_queue
  SET status = 'cancelled', last_error = 'phantom_pass_cleanup'
  WHERE status IN ('pending','failed')
    AND job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish','package_elite_harden')
    AND package_id = ANY(phantom_ids);
END $$;

-- Guard: prevent integrity done without execution
CREATE OR REPLACE FUNCTION fn_guard_integrity_requires_execution()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.step_key = 'run_integrity_check'
    AND NEW.status = 'done'
    AND (OLD.status IS DISTINCT FROM 'done')
    AND (NEW.meta->>'executed' IS NULL OR NEW.meta->>'executed' = 'false')
  THEN
    INSERT INTO ops_guardrail_events (guard_key, package_id, step_key, detail)
    VALUES ('integrity_done_without_execution', NEW.package_id, NEW.step_key,
      jsonb_build_object('blocked_meta', NEW.meta, 'source', coalesce(NEW.meta->>'finalization_source','unknown')));
    RAISE WARNING '[guard] integrity_done_without_execution blocked for %', NEW.package_id;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_integrity_requires_execution ON package_steps;
CREATE TRIGGER trg_guard_integrity_requires_execution
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  WHEN (NEW.step_key = 'run_integrity_check')
  EXECUTE FUNCTION fn_guard_integrity_requires_execution();
