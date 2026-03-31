
-- Fix: The causality guard correctly blocks quality_council from being set to 'done'
-- by the pipeline-runner. But the OLD status is 'done', so it reverts to 'done'.
-- We need to handle this: if OLD.status = 'done' and the guard blocks, set to 'queued' instead.

CREATE OR REPLACE FUNCTION fn_guard_step_causality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unmet_dep TEXT;
BEGIN
  -- Only check transitions TO 'done'
  IF NEW.status != 'done' THEN RETURN NEW; END IF;
  -- Allow meta-only updates on already-done steps
  IF OLD IS NOT NULL AND OLD.status = 'done' AND NEW.status = 'done' THEN RETURN NEW; END IF;
  
  -- Check all DAG dependencies
  SELECT dag.depends_on INTO unmet_dep
  FROM pipeline_dag_edges dag
  JOIN package_steps ps_dep ON ps_dep.package_id = NEW.package_id
                            AND ps_dep.step_key = dag.depends_on
  WHERE dag.step_key = NEW.step_key
    AND ps_dep.status NOT IN ('done', 'skipped')
  LIMIT 1;
  
  IF unmet_dep IS NOT NULL THEN
    RAISE WARNING 'CAUSALITY_GUARD: Cannot set %.% to done — dep "%" not met. Reverting to queued.',
      NEW.package_id, NEW.step_key, unmet_dep;
    NEW.status := 'queued';
    NEW.last_error := 'CAUSALITY_BLOCKED: dep ' || unmet_dep || ' not done';
    NEW.job_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Now force-reset the affected rows (the trigger won't interfere since we set to 'queued')
UPDATE package_steps
SET status = 'queued', job_id = NULL, attempts = 0,
    last_error = 'CAUSALITY_REPAIR_FINAL',
    updated_at = NOW()
WHERE step_key IN ('quality_council', 'auto_publish')
  AND status = 'done'
  AND package_id IN (
    SELECT DISTINCT ps_d.package_id
    FROM package_steps ps_d
    JOIN pipeline_dag_edges dag ON dag.step_key = ps_d.step_key
    JOIN package_steps ps_u ON ps_u.package_id = ps_d.package_id AND ps_u.step_key = dag.depends_on
    WHERE ps_d.step_key IN ('quality_council', 'auto_publish')
      AND ps_d.status = 'done'
      AND ps_u.status NOT IN ('done', 'skipped')
  );

-- Generic sweep for any other violations
UPDATE package_steps
SET status = 'queued', job_id = NULL, attempts = 0,
    last_error = 'CAUSALITY_REPAIR_FINAL_SWEEP',
    updated_at = NOW()
WHERE id IN (
  SELECT ps_d.id
  FROM package_steps ps_d
  JOIN pipeline_dag_edges dag ON dag.step_key = ps_d.step_key
  JOIN package_steps ps_u ON ps_u.package_id = ps_d.package_id AND ps_u.step_key = dag.depends_on
  WHERE ps_d.status = 'done'
    AND ps_u.status NOT IN ('done', 'skipped')
);
