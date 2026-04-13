
-- Audit view: detect drift between step_dag_edges and pipeline_dag_edges
CREATE OR REPLACE VIEW public.ops_step_dag_drift AS
WITH step_dag AS (
  SELECT step_key, depends_on, 'step_dag_edges' AS source
  FROM step_dag_edges
),
pipeline_dag AS (
  SELECT step_key, depends_on, 'pipeline_dag_edges' AS source
  FROM pipeline_dag_edges
),
all_edges AS (
  SELECT step_key, depends_on FROM step_dag
  UNION
  SELECT step_key, depends_on FROM pipeline_dag
),
classified AS (
  SELECT
    a.step_key,
    a.depends_on,
    EXISTS (SELECT 1 FROM step_dag s WHERE s.step_key = a.step_key AND s.depends_on = a.depends_on) AS in_step_dag,
    EXISTS (SELECT 1 FROM pipeline_dag p WHERE p.step_key = a.step_key AND p.depends_on = a.depends_on) AS in_pipeline_dag
  FROM all_edges a
)
SELECT
  step_key,
  depends_on,
  in_step_dag,
  in_pipeline_dag,
  CASE
    WHEN in_step_dag AND NOT in_pipeline_dag THEN 'ONLY_IN_STEP_DAG'
    WHEN NOT in_step_dag AND in_pipeline_dag THEN 'ONLY_IN_PIPELINE_DAG'
    ELSE 'IN_SYNC'
  END AS drift_status
FROM classified
WHERE NOT (in_step_dag AND in_pipeline_dag)
ORDER BY step_key, depends_on;
