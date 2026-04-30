-- ═══════════════════════════════════════════════════════════════
-- M1: LaneHealthCard — dispatch-aware View
-- ═══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_admin_lane_health CASCADE;

CREATE VIEW public.v_admin_lane_health AS
WITH active AS (
  SELECT COALESCE(lane, 'unknown'::text) AS lane,
    (count(*) FILTER (WHERE status = 'pending'))::int AS pending_cnt,
    (count(*) FILTER (WHERE status = 'processing'))::int AS processing_cnt,
    (count(*) FILTER (WHERE status = 'queued'))::int AS queued_cnt,
    (max(EXTRACT(epoch FROM (now() - created_at))) FILTER (WHERE status IN ('pending','queued')))::int AS oldest_pending_sec
  FROM public.job_queue
  WHERE status IN ('pending','processing','queued')
  GROUP BY COALESCE(lane, 'unknown'::text)
),
completed_stats AS (
  SELECT COALESCE(lane, 'unknown'::text) AS lane,
    max(completed_at) AS last_completed_at,
    (count(*) FILTER (WHERE completed_at >= now() - interval '6 hours'))::int AS completed_6h
  FROM public.job_queue
  WHERE status = 'completed'
  GROUP BY COALESCE(lane, 'unknown'::text)
),
-- Dispatch-Signal: jeder claimed/processing/recent-completed Job in den letzten 5min
-- pro lane — beweist, dass ein Worker aktiv ist (auch wenn lane-Spalte leer ist).
dispatch_signal AS (
  SELECT COALESCE(lane, 'unknown'::text) AS lane,
    (count(*) FILTER (
      WHERE (locked_at >= now() - interval '5 minutes')
         OR (started_at >= now() - interval '5 minutes')
         OR (completed_at >= now() - interval '5 minutes')
    ))::int AS dispatched_recent_5m,
    max(GREATEST(
      COALESCE(locked_at, 'epoch'::timestamptz),
      COALESCE(started_at, 'epoch'::timestamptz),
      COALESCE(completed_at, 'epoch'::timestamptz)
    )) AS last_worker_activity_at
  FROM public.job_queue
  WHERE (locked_at >= now() - interval '1 hour')
     OR (started_at >= now() - interval '1 hour')
     OR (completed_at >= now() - interval '1 hour')
  GROUP BY COALESCE(lane, 'unknown'::text)
)
SELECT a.lane,
  a.pending_cnt,
  a.processing_cnt,
  a.queued_cnt,
  c.last_completed_at,
  COALESCE(c.completed_6h, 0) AS completed_6h,
  a.oldest_pending_sec,
  COALESCE(d.dispatched_recent_5m, 0) AS dispatched_recent_5m,
  d.last_worker_activity_at
FROM active a
LEFT JOIN completed_stats c USING (lane)
LEFT JOIN dispatch_signal d USING (lane);

GRANT SELECT ON public.v_admin_lane_health TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- M3: Hot-Loop Auto-Unfreeze RPC
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_auto_unfreeze_hot_loop_steps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unfrozen int;
  v_packages int;
BEGIN
  WITH unfrozen AS (
    UPDATE public.package_steps
    SET last_error = NULL,
        attempts = 0,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'auto_unfreeze_at', now(),
          'auto_unfreeze_source', 'fn_auto_unfreeze_hot_loop_steps',
          'previous_freeze_error_snippet', left(last_error, 200)
        ),
        updated_at = now()
    WHERE status = 'queued'
      AND last_error ILIKE '%hot-loop%'
      AND last_error ILIKE '%frozen%'
      AND updated_at < now() - interval '2 hours'
    RETURNING package_id
  ),
  agg AS (
    SELECT count(*)::int AS n, count(DISTINCT package_id)::int AS pkgs FROM unfrozen
  )
  SELECT n, pkgs INTO v_unfrozen, v_packages FROM agg;

  IF v_unfrozen > 0 THEN
    INSERT INTO public.auto_heal_log
      (trigger_source, action_type, target_id, target_type, input_params, result_status, result_detail)
    VALUES
      ('cron_hot_loop_unfreeze', 'AUTO_UNFREEZE_HOT_LOOP', NULL, 'global',
       jsonb_build_object('threshold_hours', 2),
       'success',
       format('unfrozen %s steps across %s packages', v_unfrozen, v_packages));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'unfrozen_steps', v_unfrozen,
    'affected_packages', v_packages,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_unfreeze_hot_loop_steps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auto_unfreeze_hot_loop_steps() TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- M4: Track-Drift Guard
-- ═══════════════════════════════════════════════════════════════

-- View für Monitoring/Cockpit
CREATE OR REPLACE VIEW public.v_track_step_drift_packages AS
SELECT cp.id AS package_id,
       cp.title,
       cp.track::text AS track,
       cp.status::text AS package_status,
       ps.step_key,
       ps.status::text AS step_status,
       ps.updated_at,
       tsa.should_run
FROM public.package_steps ps
JOIN public.course_packages cp ON cp.id = ps.package_id
JOIN public.track_step_applicability tsa
  ON tsa.track::text = cp.track::text AND tsa.step_key = ps.step_key
WHERE ps.status::text NOT IN ('done','skipped','failed','running')
  AND tsa.should_run = false;

GRANT SELECT ON public.v_track_step_drift_packages TO authenticated, service_role;

-- Trigger erweitert: auch INSERTS und ALLE non-terminal status-Übergänge prüfen
CREATE OR REPLACE FUNCTION public.fn_auto_skip_not_applicable_package_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applicable boolean;
  v_track text;
BEGIN
  -- Bei terminalen Status nichts tun
  IF NEW.status::text IN ('done','skipped','failed') THEN
    RETURN NEW;
  END IF;

  v_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);

  IF NOT COALESCE(v_applicable, true) THEN
    SELECT track::text INTO v_track FROM public.course_packages WHERE id = NEW.package_id;

    NEW.status := 'skipped'::step_status;
    NEW.started_at := NULL;
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.last_error := NULL;
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb)
      || jsonb_build_object(
           'skip_reason', 'auto_skipped_not_applicable',
           'skip_source', 'trg_auto_skip_not_applicable_package_step_v2',
           'track', v_track,
           'original_requested_status', OLD.status::text,
           'skipped_at', now()
         );
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill-RPC: alle aktuell driftenden Steps auf skipped setzen
CREATE OR REPLACE FUNCTION public.admin_repair_track_step_drift_all(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_packages int := 0;
  v_examples jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('package_id', package_id, 'title', title, 'track', track, 'step_key', step_key, 'step_status', step_status))
  INTO v_examples
  FROM (SELECT * FROM public.v_track_step_drift_packages LIMIT 25) sub;

  IF p_dry_run THEN
    SELECT count(*)::int, count(DISTINCT package_id)::int
    INTO v_count, v_packages
    FROM public.v_track_step_drift_packages;

    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true,
      'would_skip_steps', v_count,
      'would_affect_packages', v_packages,
      'examples', COALESCE(v_examples, '[]'::jsonb)
    );
  END IF;

  WITH drifting AS (
    SELECT ps.package_id, ps.step_key
    FROM public.package_steps ps
    JOIN public.course_packages cp ON cp.id = ps.package_id
    JOIN public.track_step_applicability tsa
      ON tsa.track::text = cp.track::text AND tsa.step_key = ps.step_key
    WHERE ps.status::text NOT IN ('done','skipped','failed','running')
      AND tsa.should_run = false
  ),
  upd AS (
    UPDATE public.package_steps ps
    SET status = 'skipped'::step_status,
        last_error = NULL,
        started_at = NULL,
        finished_at = COALESCE(ps.finished_at, now()),
        meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
          'skip_reason', 'auto_skipped_not_applicable_backfill',
          'skip_source', 'admin_repair_track_step_drift_all',
          'skipped_at', now()
        ),
        updated_at = now()
    FROM drifting d
    WHERE ps.package_id = d.package_id AND ps.step_key = d.step_key
    RETURNING ps.package_id
  )
  SELECT count(*)::int, count(DISTINCT package_id)::int
  INTO v_count, v_packages FROM upd;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type, input_params, result_status, result_detail)
  VALUES
    ('admin_repair_track_step_drift', 'TRACK_DRIFT_BACKFILL', NULL, 'global',
     jsonb_build_object('dry_run', false),
     'success',
     format('skipped %s steps across %s packages', v_count, v_packages));

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false,
    'skipped_steps', v_count,
    'affected_packages', v_packages,
    'examples', COALESCE(v_examples, '[]'::jsonb),
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_repair_track_step_drift_all(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_repair_track_step_drift_all(boolean) TO authenticated, service_role;