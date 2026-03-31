
-- ============================================================
-- Pipeline Handoff Integrity Repair (v2 — fixed SQL)
-- ============================================================

-- 1. Reset quality_council to 'queued' where run_integrity_check is NOT done/skipped
UPDATE package_steps ps_qc
SET status = 'queued',
    job_id = NULL,
    attempts = 0,
    last_error = 'CAUSALITY_REPAIR: upstream run_integrity_check not done',
    updated_at = NOW()
FROM package_steps ps_ric
WHERE ps_qc.step_key = 'quality_council'
  AND ps_qc.status = 'done'
  AND ps_ric.package_id = ps_qc.package_id
  AND ps_ric.step_key = 'run_integrity_check'
  AND ps_ric.status NOT IN ('done', 'skipped');

-- 2. Reset auto_publish to 'queued' where quality_council is NOT done/skipped
UPDATE package_steps ps_ap
SET status = 'queued',
    job_id = NULL,
    attempts = 0,
    last_error = 'CAUSALITY_REPAIR: upstream quality_council not done',
    updated_at = NOW()
FROM package_steps ps_qc
WHERE ps_ap.step_key = 'auto_publish'
  AND ps_ap.status = 'done'
  AND ps_qc.package_id = ps_ap.package_id
  AND ps_qc.step_key = 'quality_council'
  AND ps_qc.status NOT IN ('done', 'skipped');

-- 3. Generic: Reset remaining downstream violations using a subquery approach
UPDATE package_steps
SET status = 'queued',
    job_id = NULL,
    attempts = 0,
    last_error = 'CAUSALITY_REPAIR: upstream dependency not done',
    updated_at = NOW()
WHERE id IN (
  SELECT ps_down.id
  FROM package_steps ps_down
  JOIN pipeline_dag_edges dag ON dag.step_key = ps_down.step_key
  JOIN package_steps ps_up ON ps_up.package_id = ps_down.package_id AND ps_up.step_key = dag.depends_on
  WHERE ps_down.status = 'done'
    AND ps_up.status NOT IN ('done', 'skipped')
);

-- 4. Create a DB trigger to PREVENT future causality violations
CREATE OR REPLACE FUNCTION fn_guard_step_causality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unmet_dep TEXT;
BEGIN
  IF NEW.status != 'done' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = 'done' THEN RETURN NEW; END IF;
  
  SELECT dag.depends_on INTO unmet_dep
  FROM pipeline_dag_edges dag
  JOIN package_steps ps_dep ON ps_dep.package_id = NEW.package_id
                            AND ps_dep.step_key = dag.depends_on
  WHERE dag.step_key = NEW.step_key
    AND ps_dep.status NOT IN ('done', 'skipped')
  LIMIT 1;
  
  IF unmet_dep IS NOT NULL THEN
    RAISE WARNING 'CAUSALITY_GUARD: Cannot set %.% to done — upstream dep "%" not done/skipped',
      NEW.package_id, NEW.step_key, unmet_dep;
    NEW.status := OLD.status;
    NEW.last_error := 'CAUSALITY_BLOCKED: dep ' || unmet_dep || ' not done';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_step_causality ON package_steps;
CREATE TRIGGER trg_guard_step_causality
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_step_causality();
