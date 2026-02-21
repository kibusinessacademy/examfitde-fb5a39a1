
-- =====================================================
-- Pipeline Alerts Tabelle (Views + RPC wurden bereits erstellt)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.pipeline_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  detail jsonb,
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_pipeline_alerts"
  ON public.pipeline_alerts FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "admin_write_pipeline_alerts"
  ON public.pipeline_alerts FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_created 
  ON pipeline_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_type 
  ON pipeline_alerts(alert_type, created_at DESC);

-- =====================================================
-- Proaktives Alerting RPC
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_pipeline_health_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerts_created int := 0;
  v_completed_1h int;
  v_failed_1h int;
  v_stuck_packages int;
  v_stale_leases int;
  v_error_rate numeric;
BEGIN
  -- 1. Throughput check: completed jobs in last hour
  SELECT COUNT(*) INTO v_completed_1h
  FROM job_queue 
  WHERE status = 'completed' 
    AND updated_at >= now() - interval '1 hour';
  
  -- 2. Failed jobs in last hour
  SELECT COUNT(*) INTO v_failed_1h
  FROM job_queue 
  WHERE status = 'failed' 
    AND updated_at >= now() - interval '1 hour';
  
  -- 3. Stuck packages (building but no active jobs)
  SELECT COUNT(*) INTO v_stuck_packages
  FROM course_packages cp
  WHERE cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq 
      WHERE jq.status IN ('pending', 'processing')
        AND jq.metadata->>'package_id' = cp.id::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM package_leases pl 
      WHERE pl.package_id = cp.id
    );
  
  -- 4. Stale leases
  SELECT COUNT(*) INTO v_stale_leases
  FROM package_leases 
  WHERE lease_until < now();
  
  -- Calculate error rate
  IF (v_completed_1h + v_failed_1h) > 0 THEN
    v_error_rate := v_failed_1h::numeric / (v_completed_1h + v_failed_1h);
  ELSE
    v_error_rate := 0;
  END IF;
  
  -- Alert: Throughput drop (0 completions in 1h while packages are building)
  IF v_completed_1h = 0 AND EXISTS (SELECT 1 FROM course_packages WHERE status = 'building') THEN
    INSERT INTO pipeline_alerts (alert_type, severity, title, detail)
    VALUES ('throughput_zero', 'critical', 
      'Pipeline-Stillstand: 0 Jobs in letzter Stunde abgeschlossen',
      jsonb_build_object('completed_1h', v_completed_1h, 'failed_1h', v_failed_1h));
    v_alerts_created := v_alerts_created + 1;
  END IF;
  
  -- Alert: High error rate (>30%)
  IF v_error_rate > 0.30 AND (v_completed_1h + v_failed_1h) >= 3 THEN
    INSERT INTO pipeline_alerts (alert_type, severity, title, detail)
    VALUES ('error_spike', 'critical',
      format('Error-Rate bei %.0f%% (%s failed / %s total)', v_error_rate * 100, v_failed_1h, v_completed_1h + v_failed_1h),
      jsonb_build_object('error_rate', v_error_rate, 'failed', v_failed_1h, 'completed', v_completed_1h));
    v_alerts_created := v_alerts_created + 1;
  END IF;
  
  -- Alert: Stuck packages
  IF v_stuck_packages > 0 THEN
    INSERT INTO pipeline_alerts (alert_type, severity, title, detail)
    VALUES ('stuck_packages', 'warning',
      format('%s Paket(e) im Status building ohne aktive Jobs', v_stuck_packages),
      jsonb_build_object('stuck_count', v_stuck_packages));
    v_alerts_created := v_alerts_created + 1;
  END IF;
  
  -- Alert: Stale leases
  IF v_stale_leases > 0 THEN
    INSERT INTO pipeline_alerts (alert_type, severity, title, detail)
    VALUES ('stale_leases', 'warning',
      format('%s abgelaufene Lease(s) blockieren WIP-Slots', v_stale_leases),
      jsonb_build_object('stale_count', v_stale_leases));
    v_alerts_created := v_alerts_created + 1;
  END IF;
  
  RETURN jsonb_build_object(
    'alerts_created', v_alerts_created,
    'metrics', jsonb_build_object(
      'completed_1h', v_completed_1h,
      'failed_1h', v_failed_1h,
      'error_rate', v_error_rate,
      'stuck_packages', v_stuck_packages,
      'stale_leases', v_stale_leases
    )
  );
END;
$$;
