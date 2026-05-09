
-- Track A: Quality Gate Decision History

CREATE TABLE IF NOT EXISTS public.quality_gate_decision_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  decision text NOT NULL,
  prev_decision text,
  quality_score numeric,
  quality_badge text,
  bronze_locked boolean DEFAULT false,
  report_status text,
  rules_failed integer,
  rules_warned integer,
  report_signal text,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_qgdh_package_recorded
  ON public.quality_gate_decision_history(package_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_qgdh_decision_recorded
  ON public.quality_gate_decision_history(decision, recorded_at DESC);

ALTER TABLE public.quality_gate_decision_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qgdh_admin_select" ON public.quality_gate_decision_history;
CREATE POLICY "qgdh_admin_select"
  ON public.quality_gate_decision_history
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Snapshot RPC (service-role caller via cron)
CREATE OR REPLACE FUNCTION public.fn_snapshot_quality_gate_decisions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted int := 0;
  v_pending int;
  v_failed_15m int;
  v_total_15m int;
  v_failure_rate numeric;
  v_reaper_churn int;
  v_gate jsonb;
  v_inputs jsonb;
BEGIN
  SELECT COUNT(*)::int,
         (SELECT COUNT(*) FILTER (WHERE status='failed')::int FROM public.job_queue
            WHERE COALESCE(completed_at, updated_at) > now() - interval '15 minutes'),
         (SELECT COUNT(*)::int FROM public.job_queue
            WHERE COALESCE(completed_at, updated_at) > now() - interval '15 minutes')
    INTO v_pending, v_failed_15m, v_total_15m
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND COALESCE(worker_pool,'default')='default';

  v_failure_rate := CASE WHEN v_total_15m>0 THEN v_failed_15m::numeric/v_total_15m ELSE 0 END;

  SELECT COUNT(*)::int INTO v_reaper_churn
    FROM public.auto_heal_log
   WHERE action_type IN ('reap_stale_processing_job','stale_reap')
     AND created_at > now() - interval '5 minutes';

  v_gate := public.fn_worker_health_gate();
  v_inputs := jsonb_build_object(
    'pending_default_pool', v_pending,
    'failure_rate_15m', v_failure_rate,
    'reaper_churn_5m', v_reaper_churn,
    'lane', 'all',
    'pool', 'default',
    'gate_health', v_gate,
    'snapshot_at', now()
  );

  WITH last_per_pkg AS (
    SELECT DISTINCT ON (package_id) package_id, decision
      FROM public.quality_gate_decision_history
     ORDER BY package_id, recorded_at DESC
  ),
  current_state AS (
    SELECT v.package_id, v.gate_decision AS decision, v.quality_score, v.quality_badge,
           v.bronze_locked, v.report_status, v.rules_failed, v.rules_warned, v.report_signal
      FROM public.v_quality_gate_decision_per_pkg v
  ),
  changed AS (
    SELECT cs.*, lpp.decision AS prev_decision
      FROM current_state cs
      LEFT JOIN last_per_pkg lpp ON lpp.package_id = cs.package_id
     WHERE lpp.decision IS DISTINCT FROM cs.decision
  ),
  ins AS (
    INSERT INTO public.quality_gate_decision_history
      (package_id, decision, prev_decision, quality_score, quality_badge, bronze_locked,
       report_status, rules_failed, rules_warned, report_signal, inputs, recorded_by)
    SELECT package_id, decision, prev_decision, quality_score, quality_badge, bronze_locked,
           report_status, rules_failed, rules_warned, report_signal, v_inputs, 'cron_snapshot'
      FROM changed
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_inserted FROM ins;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('gate_decision_snapshot','system',
          CASE WHEN v_inserted>0 THEN 'success' ELSE 'noop' END,
          jsonb_build_object('inserted', v_inserted, 'inputs', v_inputs));

  RETURN jsonb_build_object('inserted', v_inserted, 'inputs', v_inputs);
END $$;

REVOKE ALL ON FUNCTION public.fn_snapshot_quality_gate_decisions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_snapshot_quality_gate_decisions() TO service_role;

-- Admin manual trigger
CREATE OR REPLACE FUNCTION public.admin_record_gate_decisions_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN public.fn_snapshot_quality_gate_decisions();
END $$;

GRANT EXECUTE ON FUNCTION public.admin_record_gate_decisions_now() TO authenticated;

-- Admin read RPC
CREATE OR REPLACE FUNCTION public.admin_get_gate_decision_history(
  p_package_id uuid,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  decision text,
  prev_decision text,
  quality_score numeric,
  quality_badge text,
  bronze_locked boolean,
  report_status text,
  rules_failed integer,
  rules_warned integer,
  report_signal text,
  inputs jsonb,
  recorded_at timestamptz,
  recorded_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
    SELECT h.id, h.decision, h.prev_decision, h.quality_score, h.quality_badge,
           h.bronze_locked, h.report_status, h.rules_failed, h.rules_warned,
           h.report_signal, h.inputs, h.recorded_at, h.recorded_by
      FROM public.quality_gate_decision_history h
     WHERE h.package_id = p_package_id
     ORDER BY h.recorded_at DESC
     LIMIT GREATEST(LEAST(p_limit, 500), 1);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_gate_decision_history(uuid, int) TO authenticated;

-- Cron every 10 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='gate-decision-snapshot-10min') THEN
    PERFORM cron.unschedule('gate-decision-snapshot-10min');
  END IF;
  PERFORM cron.schedule('gate-decision-snapshot-10min', '*/10 * * * *',
    $cron$ SELECT public.fn_snapshot_quality_gate_decisions(); $cron$);
END $$;
