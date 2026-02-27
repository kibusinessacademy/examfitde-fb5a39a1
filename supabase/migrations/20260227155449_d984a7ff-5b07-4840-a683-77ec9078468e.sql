
-- ================================
-- OPS GUARD PACK (DB)
-- ================================

-- 1) Alert events table (SSOT für Alarme)
CREATE TABLE IF NOT EXISTS public.ops_alert_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  alert_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warn','critical')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_hash text NOT NULL,
  resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ops_alert_events_key_idx ON public.ops_alert_events(alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS ops_alert_events_open_idx ON public.ops_alert_events(alert_key) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ops_alert_events_dedupe_uniq ON public.ops_alert_events(dedupe_hash) WHERE resolved_at IS NULL;

ALTER TABLE public.ops_alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.ops_alert_events
  FOR ALL USING (true) WITH CHECK (true);

REVOKE ALL ON public.ops_alert_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_alert_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ops_alert_events_id_seq TO service_role;

-- 2) Helper: stable hash (dedupe)
CREATE OR REPLACE FUNCTION public.ops_hash_dedupe(p_alert_key text, p_details jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(coalesce(p_alert_key,'') || '|' || coalesce(p_details::text,'{}'));
$$;

-- 3) OPS View: runner + queue integrity snapshot
CREATE OR REPLACE VIEW public.ops_runner_integrity AS
SELECT
  now() AS as_of,
  (SELECT count(*) FROM public.package_leases pl JOIN public.course_packages cp ON cp.id = pl.package_id WHERE pl.lease_until > now() AND cp.status <> 'building') AS orphan_leases,
  (SELECT count(*) FROM public.job_queue jq JOIN public.course_packages cp ON cp.id::text = (jq.payload->>'package_id') WHERE jq.status = 'pending' AND cp.status <> 'building') AS pending_non_building,
  (SELECT count(*) FROM public.job_queue jq JOIN public.course_packages cp ON cp.id::text = (jq.payload->>'package_id') WHERE jq.status = 'processing' AND cp.status <> 'building') AS processing_non_building,
  (SELECT count(*) FROM public.job_queue jq WHERE jq.status = 'processing' AND jq.started_at IS NOT NULL AND jq.started_at < now() - interval '10 minutes') AS stuck_processing_10m,
  (SELECT count(*) FROM public.job_queue jq WHERE jq.status = 'pending' AND (jq.meta->>'artifact_blocked')::boolean IS TRUE AND (jq.run_after IS NULL OR jq.run_after <= now())) AS blocked_pending_ready;

-- 4) Hollow Completion view (uses finished_at, not completed_at)
CREATE OR REPLACE VIEW public.ops_hollow_completions AS
SELECT
  ps.package_id,
  cp.curriculum_id,
  ps.step_key,
  ps.finished_at,
  ps.meta,
  'exam_questions'::text AS artifact_table,
  0::int AS artifact_count
FROM public.package_steps ps
JOIN public.course_packages cp ON cp.id = ps.package_id
WHERE ps.step_key = 'generate_exam_pool'
  AND ps.status = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM public.exam_questions eq
    WHERE eq.curriculum_id = cp.curriculum_id
  );

-- 5) Guard: insert alert event (deduped)
CREATE OR REPLACE FUNCTION public.ops_raise_alert(
  p_alert_key text,
  p_severity text,
  p_summary text,
  p_details jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  v_hash := public.ops_hash_dedupe(p_alert_key, p_details);
  INSERT INTO public.ops_alert_events(alert_key, severity, summary, details, dedupe_hash)
  VALUES (p_alert_key, p_severity, p_summary, coalesce(p_details,'{}'::jsonb), v_hash)
  ON CONFLICT (dedupe_hash) WHERE resolved_at IS NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_raise_alert(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_raise_alert(text,text,text,jsonb) TO service_role;

-- 6) Runner Integrity Check (writes alerts, returns snapshot)
CREATE OR REPLACE FUNCTION public.ops_run_integrity_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_hollow_cnt int;
BEGIN
  SELECT * INTO v FROM public.ops_runner_integrity;
  SELECT count(*) INTO v_hollow_cnt FROM public.ops_hollow_completions;

  IF coalesce(v.orphan_leases,0) > 0 THEN
    PERFORM public.ops_raise_alert('ORPHAN_LEASES_NON_BUILDING', 'critical',
      'Orphan leases detected: leases exist for non-building packages',
      jsonb_build_object('count', v.orphan_leases));
  END IF;

  IF coalesce(v.pending_non_building,0) > 0 THEN
    PERFORM public.ops_raise_alert('PENDING_JOBS_NON_BUILDING', 'warn',
      'Pending jobs exist for non-building packages (queue hygiene)',
      jsonb_build_object('count', v.pending_non_building));
  END IF;

  IF coalesce(v.processing_non_building,0) > 0 THEN
    PERFORM public.ops_raise_alert('PROCESSING_JOBS_NON_BUILDING', 'critical',
      'Processing jobs exist for non-building packages (eligibility bug)',
      jsonb_build_object('count', v.processing_non_building));
  END IF;

  IF coalesce(v.stuck_processing_10m,0) > 0 THEN
    PERFORM public.ops_raise_alert('STUCK_PROCESSING_JOBS_10M', 'warn',
      'Jobs stuck in processing > 10 minutes',
      jsonb_build_object('count', v.stuck_processing_10m));
  END IF;

  IF coalesce(v.blocked_pending_ready,0) > 0 THEN
    PERFORM public.ops_raise_alert('BLOCKED_PENDING_READY', 'info',
      'Blocked pending jobs ready now (artifact_blocked)',
      jsonb_build_object('count', v.blocked_pending_ready));
  END IF;

  IF v_hollow_cnt > 0 THEN
    PERFORM public.ops_raise_alert('HOLLOW_COMPLETION_EXAM_POOL', 'critical',
      'Hollow completion: generate_exam_pool done but 0 exam_questions exist',
      jsonb_build_object('count', v_hollow_cnt));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'snapshot', jsonb_build_object(
      'orphan_leases', coalesce(v.orphan_leases,0),
      'pending_non_building', coalesce(v.pending_non_building,0),
      'processing_non_building', coalesce(v.processing_non_building,0),
      'stuck_processing_10m', coalesce(v.stuck_processing_10m,0),
      'blocked_pending_ready', coalesce(v.blocked_pending_ready,0),
      'hollow_completion_exam_pool', v_hollow_cnt
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ops_run_integrity_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_run_integrity_checks() TO service_role;

-- 7) Remediation: expire orphan leases
CREATE OR REPLACE FUNCTION public.ops_expire_orphan_leases()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.package_leases pl
  SET lease_until = now() - interval '1 second',
      renewed_at = now(),
      runner_id = 'ops-expire-orphans'
  FROM public.course_packages cp
  WHERE pl.package_id = cp.id
    AND pl.lease_until > now()
    AND cp.status <> 'building';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_expire_orphan_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_expire_orphan_leases() TO service_role;

-- 8) Remediation: cancel pending jobs on non-building packages
CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.job_queue jq
  SET status = 'canceled',
      updated_at = now(),
      meta = coalesce(jq.meta,'{}'::jsonb) || jsonb_build_object(
        'canceled_by', 'ops_guard',
        'canceled_reason', 'NON_BUILDING_PACKAGE'
      )
  FROM public.course_packages cp
  WHERE jq.status = 'pending'
    AND cp.id::text = (jq.payload->>'package_id')
    AND cp.status <> 'building';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_cancel_pending_non_building_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_cancel_pending_non_building_jobs() TO service_role;
