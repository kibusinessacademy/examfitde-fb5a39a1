
CREATE OR REPLACE FUNCTION public.capture_step_done_output_missing_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_count  int;
  v_breakdown jsonb;
  v_claims  text;
BEGIN
  v_claims := current_setting('request.jwt.claims', true);
  IF NOT (
       public.has_role(auth.uid(), 'admin')
       OR v_claims IS NULL
       OR v_claims = ''
       OR (v_claims::jsonb->>'role') = 'service_role'
     ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  INSERT INTO public.step_done_output_missing_snapshots
    (run_id, step_key, package_id, step_id, job_id,
     finalized_by, finalization_source, root_cause_code, evidence, finished_at)
  SELECT v_run_id, step_key, package_id, step_id, job_id,
         finalized_by, finalization_source, root_cause_code, evidence, finished_at
  FROM public.v_step_done_output_missing;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT jsonb_object_agg(root_cause_code, n)
    INTO v_breakdown
  FROM (
    SELECT root_cause_code, COUNT(*) AS n
    FROM public.step_done_output_missing_snapshots
    WHERE run_id = v_run_id
    GROUP BY root_cause_code
  ) s;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'count', v_count,
    'breakdown', COALESCE(v_breakdown, '{}'::jsonb),
    'captured_at', now()
  );
END;
$$;
