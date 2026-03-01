-- Guardrail event log table
CREATE TABLE IF NOT EXISTS public.ops_guardrail_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  guard_key text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ops_guardrail_events ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (admin-only table)
CREATE POLICY "Service role full access" ON public.ops_guardrail_events
  FOR ALL USING (auth.role() = 'service_role');

-- Nightly guard function (callable from pg_cron or edge function)
CREATE OR REPLACE FUNCTION public.run_nightly_pipeline_guards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_not_ok int;
  v_queued_stale int;
  v_building_done_wo_started int;
  v_result jsonb;
BEGIN
  SELECT count(*) INTO v_done_not_ok
  FROM public.package_steps ps
  WHERE ps.status = 'done'
    AND (ps.meta ? 'ok')
    AND (ps.meta->>'ok')::text <> 'true';

  SELECT count(*) INTO v_queued_stale
  FROM public.package_steps ps
  WHERE ps.status = 'queued'
    AND (ps.meta ? 'ok' OR ps.meta ? 'batch_complete');

  SELECT count(*) INTO v_building_done_wo_started
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'building'
    AND ps.status = 'done'
    AND ps.started_at IS NULL
    AND ps.finished_at IS NOT NULL;

  -- Log events for non-zero findings
  IF v_done_not_ok > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('done_implies_ok', jsonb_build_object('count', v_done_not_ok));
  END IF;

  IF v_queued_stale > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('queued_meta_hygiene', jsonb_build_object('count', v_queued_stale));
  END IF;

  IF v_building_done_wo_started > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('building_done_without_started_at', jsonb_build_object('count', v_building_done_wo_started));
  END IF;

  v_result := jsonb_build_object(
    'done_but_not_ok', v_done_not_ok,
    'queued_with_stale_meta', v_queued_stale,
    'building_done_without_started_at', v_building_done_wo_started,
    'all_clear', (v_done_not_ok = 0 AND v_queued_stale = 0 AND v_building_done_wo_started = 0),
    'checked_at', now()
  );

  RETURN v_result;
END;
$$;

-- Restrict to service_role only
REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM anon;
REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_nightly_pipeline_guards() TO service_role;