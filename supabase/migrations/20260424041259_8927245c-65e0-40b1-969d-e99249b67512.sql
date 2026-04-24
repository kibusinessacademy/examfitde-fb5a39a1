-- =============================================================================
-- Migration v2: Pending-Enqueue Auto-Reschedule + One-Shot Bulk-Heal
-- Fix: Cursor-Loop separiert von UPDATE (vermeidet AFTER-Trigger-Konflikt
--      mit cascade_reset_downstream_steps).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Audit-Log Tabelle
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_enqueue_reschedule_log (
  id BIGSERIAL PRIMARY KEY,
  package_id UUID NOT NULL,
  step_key TEXT NOT NULL,
  prev_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  triggered_by TEXT NOT NULL DEFAULT 'cron',
  age_seconds INTEGER,
  meta_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perl_pkg_step_created
  ON public.pending_enqueue_reschedule_log (package_id, step_key, created_at DESC);

ALTER TABLE public.pending_enqueue_reschedule_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_perl" ON public.pending_enqueue_reschedule_log;
CREATE POLICY "admin_read_perl" ON public.pending_enqueue_reschedule_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Reschedule-Funktion (Snapshot-then-Update Pattern)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reschedule_pending_enqueue_steps(
  p_min_age_seconds INTEGER DEFAULT 300,
  p_max_per_run     INTEGER DEFAULT 25,
  p_triggered_by    TEXT    DEFAULT 'cron'
)
RETURNS TABLE (
  rescheduled_count    INTEGER,
  skipped_active       INTEGER,
  skipped_not_building INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _candidate RECORD;
  _rescheduled INTEGER := 0;
  _skipped_active INTEGER := 0;
  _skipped_not_building INTEGER := 0;
  _job_type TEXT;
  _has_active BOOLEAN;
  _pkg_status TEXT;
  _affected INTEGER;
BEGIN
  -- Phase 1: Kandidaten in TEMP snapshotten (Cursor wird sofort geschlossen)
  CREATE TEMP TABLE _per_candidates ON COMMIT DROP AS
  SELECT ps.package_id, ps.step_key, ps.updated_at, ps.meta,
         EXTRACT(EPOCH FROM (now() - ps.updated_at))::int AS age_s
  FROM public.package_steps ps
  WHERE ps.status = 'pending_enqueue'
    AND ps.updated_at < now() - make_interval(secs => p_min_age_seconds)
  ORDER BY ps.updated_at ASC
  LIMIT p_max_per_run;

  -- Phase 2: einzeln verarbeiten
  FOR _candidate IN SELECT * FROM _per_candidates LOOP
    SELECT cp.status INTO _pkg_status
    FROM public.course_packages cp
    WHERE cp.id = _candidate.package_id;

    IF _pkg_status IS DISTINCT FROM 'building' THEN
      _skipped_not_building := _skipped_not_building + 1;
      CONTINUE;
    END IF;

    _job_type := 'package_' || _candidate.step_key;

    SELECT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = _candidate.package_id
        AND jq.job_type = _job_type
        AND jq.status IN ('pending','queued','processing','running','batch_pending')
    ) INTO _has_active;

    IF _has_active THEN
      _skipped_active := _skipped_active + 1;
      CONTINUE;
    END IF;

    -- Update mit defensivem WHERE auf aktuellen Status
    BEGIN
      UPDATE public.package_steps
         SET status = 'queued',
             meta = COALESCE(meta, '{}'::jsonb)
                    || jsonb_build_object(
                         'pending_enqueue_rescheduled_at', now(),
                         'pending_enqueue_rescheduled_by', p_triggered_by,
                         'pending_enqueue_age_s', _candidate.age_s
                       )
       WHERE package_id = _candidate.package_id
         AND step_key   = _candidate.step_key
         AND status     = 'pending_enqueue';

      GET DIAGNOSTICS _affected = ROW_COUNT;

      IF _affected > 0 THEN
        INSERT INTO public.pending_enqueue_reschedule_log
          (package_id, step_key, prev_status, new_status, reason, triggered_by, age_seconds, meta_snapshot)
        VALUES
          (_candidate.package_id, _candidate.step_key, 'pending_enqueue', 'queued',
           'auto_reschedule_after_min_age', p_triggered_by, _candidate.age_s, _candidate.meta);

        _rescheduled := _rescheduled + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.pending_enqueue_reschedule_log
        (package_id, step_key, prev_status, new_status, reason, triggered_by, age_seconds, meta_snapshot)
      VALUES
        (_candidate.package_id, _candidate.step_key, 'pending_enqueue', 'pending_enqueue',
         'reschedule_failed: ' || SQLERRM, p_triggered_by, _candidate.age_s, _candidate.meta);
    END;
  END LOOP;

  DROP TABLE IF EXISTS _per_candidates;

  RETURN QUERY SELECT _rescheduled, _skipped_active, _skipped_not_building;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reschedule_pending_enqueue_steps(INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reschedule_pending_enqueue_steps(INTEGER, INTEGER, TEXT)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) One-Shot Bulk-Heal (>30min)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  _r RECORD;
BEGIN
  SELECT * INTO _r
  FROM public.fn_reschedule_pending_enqueue_steps(
    p_min_age_seconds := 1800,
    p_max_per_run     := 100,
    p_triggered_by    := 'migration_bulk_heal_2026_04_24'
  );
  RAISE NOTICE 'Bulk-Heal: rescheduled=% skipped_active=% skipped_not_building=%',
    _r.rescheduled_count, _r.skipped_active, _r.skipped_not_building;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Diagnose-View
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_pending_enqueue_stuck AS
SELECT
  ps.package_id,
  cp.title       AS package_title,
  cp.status      AS package_status,
  ps.step_key,
  ps.updated_at  AS pending_since,
  EXTRACT(EPOCH FROM (now() - ps.updated_at))::int AS age_seconds,
  ps.meta,
  EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.package_id = ps.package_id
      AND jq.job_type   = 'package_' || ps.step_key
      AND jq.status IN ('pending','queued','processing','running','batch_pending')
  ) AS has_active_job
FROM public.package_steps ps
LEFT JOIN public.course_packages cp ON cp.id = ps.package_id
WHERE ps.status = 'pending_enqueue';

GRANT SELECT ON public.v_pending_enqueue_stuck TO authenticated;