-- Smoke assertion view: surfaces any active package where build_progress drifts from SSOT
CREATE OR REPLACE VIEW public.v_ops_progress_drift_smoke AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress AS stored_progress,
  vp.progress_pct AS ssot_progress,
  cp.build_progress - vp.progress_pct AS drift_pp,
  vp.steps_done,
  vp.steps_functional,
  vp.steps_skipped
FROM course_packages cp
JOIN v_package_progress_ssot vp ON vp.package_id = cp.id
WHERE cp.status IN ('building', 'quality_gate_failed', 'blocked', 'integrity_check')
  AND cp.build_progress IS DISTINCT FROM vp.progress_pct;

COMMENT ON VIEW public.v_ops_progress_drift_smoke IS 
'Smoke assertion: should always return 0 rows. Any row = progress drift between course_packages.build_progress and v_package_progress_ssot.';