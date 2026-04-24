-- =========================================================================
-- 1. Cron Health Monitor View
-- =========================================================================
-- Zeigt Status aller pending_enqueue-bezogenen Cron-Jobs + Run-Statistik.
-- Nutzt cron.job_run_details + pending_enqueue_reschedule_log für Healing-Counts.

CREATE OR REPLACE VIEW public.v_pending_enqueue_cron_health AS
WITH cron_jobs AS (
  SELECT
    jobid,
    jobname,
    schedule,
    active,
    command
  FROM cron.job
  WHERE jobname LIKE '%pending_enqueue%'
),
last_runs AS (
  SELECT DISTINCT ON (jrd.jobid)
    jrd.jobid,
    jrd.runid,
    jrd.status        AS last_status,
    jrd.start_time    AS last_start,
    jrd.end_time      AS last_end,
    jrd.return_message AS last_message
  FROM cron.job_run_details jrd
  WHERE jrd.jobid IN (SELECT jobid FROM cron_jobs)
  ORDER BY jrd.jobid, jrd.start_time DESC
),
heal_stats_1h AS (
  SELECT
    triggered_by,
    COUNT(*) FILTER (WHERE reason = 'reschedule_to_queued')                  AS healed_1h,
    COUNT(*) FILTER (WHERE reason LIKE 'reschedule_failed%')                 AS failed_1h,
    COUNT(*) FILTER (WHERE reason = 'skipped_no_active_jobs_check_failed')   AS skipped_1h,
    MAX(created_at)                                                          AS last_log_at
  FROM public.pending_enqueue_reschedule_log
  WHERE created_at > now() - interval '1 hour'
  GROUP BY triggered_by
)
SELECT
  cj.jobname,
  cj.schedule,
  cj.active,
  lr.last_start,
  lr.last_end,
  lr.last_status,
  lr.last_message,
  EXTRACT(EPOCH FROM (now() - lr.last_start))::int AS seconds_since_last_run,
  CASE
    WHEN NOT cj.active                                            THEN 'disabled'
    WHEN lr.last_start IS NULL                                    THEN 'never_ran'
    WHEN lr.last_status = 'failed'                                THEN 'last_run_failed'
    WHEN cj.schedule = '* * * * *'   AND now() - lr.last_start > interval '3 min'  THEN 'lagging'
    WHEN cj.schedule = '*/5 * * * *' AND now() - lr.last_start > interval '15 min' THEN 'lagging'
    ELSE 'healthy'
  END AS health,
  COALESCE(hs.healed_1h, 0)  AS healed_1h,
  COALESCE(hs.failed_1h, 0)  AS failed_1h,
  COALESCE(hs.skipped_1h, 0) AS skipped_1h,
  hs.last_log_at
FROM cron_jobs cj
LEFT JOIN last_runs lr ON lr.jobid = cj.jobid
LEFT JOIN heal_stats_1h hs
  ON hs.triggered_by = CASE
       WHEN cj.jobname = 'pending_enqueue_reschedule_minutely' THEN 'cron'
       ELSE cj.jobname
     END
ORDER BY cj.jobname;

GRANT SELECT ON public.v_pending_enqueue_cron_health TO authenticated;

COMMENT ON VIEW public.v_pending_enqueue_cron_health IS
'Health-Monitor für alle pending_enqueue-bezogenen Cron-Jobs (Lag, Last-Run, Heal/Skip/Fail-Counts der letzten Stunde). Admin-only via RLS auf Source-Tabellen.';

-- =========================================================================
-- 2. Manual Review Queue
-- =========================================================================
-- Steps, die wegen Cascade-Trigger-Konflikten NICHT automatisch reschedulebar sind.
-- Werden niemals automatisch geheilt — nur manuelle Auflösung erlaubt.

CREATE TABLE IF NOT EXISTS public.pending_enqueue_manual_review (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      uuid NOT NULL,
  step_key        text NOT NULL,
  failure_count   integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at  timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','investigating','resolved','wont_fix')),
  resolution_note text,
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, step_key, status) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_pending_enqueue_manual_review_status
  ON public.pending_enqueue_manual_review(status, last_failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_enqueue_manual_review_package
  ON public.pending_enqueue_manual_review(package_id);

ALTER TABLE public.pending_enqueue_manual_review ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view manual review queue" ON public.pending_enqueue_manual_review;
CREATE POLICY "Admins can view manual review queue"
  ON public.pending_enqueue_manual_review
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update manual review queue" ON public.pending_enqueue_manual_review;
CREATE POLICY "Admins can update manual review queue"
  ON public.pending_enqueue_manual_review
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- updated_at Trigger
CREATE OR REPLACE FUNCTION public.fn_pending_enqueue_manual_review_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pending_enqueue_manual_review_touch ON public.pending_enqueue_manual_review;
CREATE TRIGGER trg_pending_enqueue_manual_review_touch
  BEFORE UPDATE ON public.pending_enqueue_manual_review
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_pending_enqueue_manual_review_touch();

-- =========================================================================
-- 3. Flagger-Funktion: Scannt Log nach wiederholten Fehlern und flaggt Steps
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_flag_pending_enqueue_manual_review(
  p_min_failures   integer DEFAULT 2,
  p_window_minutes integer DEFAULT 30
)
RETURNS TABLE (
  flagged_count integer,
  details       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _flagged integer := 0;
  _details jsonb   := '[]'::jsonb;
  _row     record;
BEGIN
  FOR _row IN
    SELECT
      l.package_id,
      l.step_key,
      COUNT(*)            AS failure_count,
      MIN(l.created_at)   AS first_failed_at,
      MAX(l.created_at)   AS last_failed_at,
      (ARRAY_AGG(l.reason ORDER BY l.created_at DESC))[1] AS last_error
    FROM public.pending_enqueue_reschedule_log l
    WHERE l.created_at > now() - make_interval(mins => p_window_minutes)
      AND l.reason LIKE 'reschedule_failed%'
    GROUP BY l.package_id, l.step_key
    HAVING COUNT(*) >= p_min_failures
  LOOP
    -- nur flaggen, wenn kein offener Review-Eintrag existiert
    IF NOT EXISTS (
      SELECT 1
      FROM public.pending_enqueue_manual_review mr
      WHERE mr.package_id = _row.package_id
        AND mr.step_key   = _row.step_key
        AND mr.status IN ('open','investigating')
    ) THEN
      INSERT INTO public.pending_enqueue_manual_review
        (package_id, step_key, failure_count, first_failed_at, last_failed_at, last_error, status)
      VALUES
        (_row.package_id, _row.step_key, _row.failure_count, _row.first_failed_at, _row.last_failed_at, _row.last_error, 'open');

      _flagged := _flagged + 1;
      _details := _details || jsonb_build_object(
        'package_id',    _row.package_id,
        'step_key',      _row.step_key,
        'failure_count', _row.failure_count,
        'last_error',    _row.last_error
      );
    ELSE
      -- bestehenden Eintrag updaten (counter + last_failed_at)
      UPDATE public.pending_enqueue_manual_review
         SET failure_count  = _row.failure_count,
             last_failed_at = _row.last_failed_at,
             last_error     = _row.last_error
       WHERE package_id = _row.package_id
         AND step_key   = _row.step_key
         AND status IN ('open','investigating');
    END IF;
  END LOOP;

  RETURN QUERY SELECT _flagged, _details;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_flag_pending_enqueue_manual_review(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_flag_pending_enqueue_manual_review(integer, integer) TO service_role;

-- =========================================================================
-- 4. Cron-Job: alle 5 min flaggen
-- =========================================================================
SELECT cron.schedule(
  'pending_enqueue_manual_review_flagger',
  '*/5 * * * *',
  $cron$ SELECT public.fn_flag_pending_enqueue_manual_review(2, 30); $cron$
);
