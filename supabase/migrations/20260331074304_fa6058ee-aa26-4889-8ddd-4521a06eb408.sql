
-- Direct reset of remaining active causality violations
UPDATE package_steps
SET status = 'queued', job_id = NULL, attempts = 0,
    last_error = 'CAUSALITY_REPAIR_R3: run_integrity_check not done',
    updated_at = NOW()
WHERE step_key = 'quality_council'
  AND status = 'done'
  AND package_id IN (
    '3057f0c0-44d7-47dc-90b1-7e2033da7062',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  );

-- Also reset auto_publish for these packages
UPDATE package_steps
SET status = 'queued', job_id = NULL, attempts = 0,
    last_error = 'CAUSALITY_REPAIR_R3: quality_council reset',
    updated_at = NOW()
WHERE step_key = 'auto_publish'
  AND status = 'done'
  AND package_id IN (
    '3057f0c0-44d7-47dc-90b1-7e2033da7062',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  );

-- Full sweep: all remaining violations on queued/archived packages too
UPDATE package_steps
SET status = 'queued', job_id = NULL, attempts = 0,
    last_error = 'CAUSALITY_REPAIR_SWEEP',
    updated_at = NOW()
WHERE id IN (
  SELECT ps_d.id
  FROM package_steps ps_d
  JOIN pipeline_dag_edges dag ON dag.step_key = ps_d.step_key
  JOIN package_steps ps_u ON ps_u.package_id = ps_d.package_id AND ps_u.step_key = dag.depends_on
  WHERE ps_d.status = 'done'
    AND ps_u.status NOT IN ('done', 'skipped')
);
