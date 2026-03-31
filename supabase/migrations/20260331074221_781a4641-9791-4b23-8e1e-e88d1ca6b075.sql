
-- Cascading causality repair — second pass
-- Reset quality_council where run_integrity_check still not done
UPDATE package_steps
SET status = 'queued', job_id = NULL, attempts = 0,
    last_error = 'CAUSALITY_REPAIR_R2: upstream not done',
    updated_at = NOW()
WHERE id IN (
  SELECT ps_down.id
  FROM package_steps ps_down
  JOIN pipeline_dag_edges dag ON dag.step_key = ps_down.step_key
  JOIN package_steps ps_up ON ps_up.package_id = ps_down.package_id AND ps_up.step_key = dag.depends_on
  WHERE ps_down.status = 'done'
    AND ps_up.status NOT IN ('done', 'skipped')
);
