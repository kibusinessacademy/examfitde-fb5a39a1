
-- SQL Assertion Function: callable by watchdog or CI
CREATE OR REPLACE FUNCTION public.assert_ops_jobtype_step_map_complete()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(step_key ORDER BY step_key)
  INTO v_missing
  FROM (
    SELECT DISTINCT ps.step_key
    FROM public.package_steps ps
    LEFT JOIN public.ops_jobtype_step_map m ON m.step_key = ps.step_key
    WHERE m.step_key IS NULL
      AND ps.step_key IS NOT NULL
  ) sub;

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'ops_jobtype_step_map is incomplete — missing step_keys: %',
      array_to_string(v_missing, ', ')
    USING HINT = 'Update ops_jobtype_step_map VIEW to stay in parity with STEP_TO_JOB_TYPE in _shared/job-map.ts';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_ops_jobtype_step_map_complete() IS
  'Raises exception when package_steps contains step_keys missing from ops_jobtype_step_map. Call from watchdog or CI.';
