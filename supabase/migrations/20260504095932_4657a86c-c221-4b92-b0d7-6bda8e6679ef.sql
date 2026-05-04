CREATE OR REPLACE FUNCTION public.fn_step_already_terminal(p_job_type text, p_package_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_payload->>'_origin','') = 'competency_coverage_repair' THEN false
    WHEN COALESCE(p_payload->>'mode','') = 'targeted_competency_fill' THEN false
    WHEN COALESCE(p_payload->>'enqueue_source','') = 'competency_coverage_repair' THEN false
    ELSE EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = p_package_id
        AND ps.step_key = regexp_replace(p_job_type, '^package_', '')
        AND ps.status IN ('done','skipped')
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_step_already_terminal(p_job_type text, p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.fn_step_already_terminal(p_job_type, p_package_id, '{}'::jsonb);
$$;

DO $migrate$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='claim_pending_jobs_by_types'
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE NOTICE 'claim_pending_jobs_by_types not found';
    RETURN;
  END IF;

  v_new := replace(v_src, 'replace(jq.job_type, ''package_'', '''')', 'regexp_replace(jq.job_type, ''^package_'', '''')');
  v_new := replace(v_new, 'replace(jq.job_type,''package_'','''')',   'regexp_replace(jq.job_type, ''^package_'', '''')');

  IF v_new = v_src THEN
    RAISE NOTICE 'No replace() call patched in claim_pending_jobs_by_types';
  ELSE
    EXECUTE v_new;
    RAISE NOTICE 'Patched claim_pending_jobs_by_types';
  END IF;
END
$migrate$;

COMMENT ON FUNCTION public.fn_step_already_terminal(text, uuid, jsonb) IS
  'Phantom-step gate. Repair-mode jobs (_origin/mode/enqueue_source = competency_coverage_repair / targeted_competency_fill) bypass. Step-key via regexp_replace ^package_.';

INSERT INTO auto_heal_log(action_type, target_type, result_status, error_message, metadata)
VALUES (
  'phantom_guard_regex_anchor_fix',
  'system',
  'ok',
  NULL,
  jsonb_build_object(
    'migration_ts', now(),
    'note', 'fn_step_already_terminal + claim_pending_jobs_by_types now use regexp_replace(^package_) for strict step-key derivation'
  )
);