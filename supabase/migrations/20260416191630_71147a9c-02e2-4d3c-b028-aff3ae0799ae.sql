-- Live-Verifikations-View für Heartbeat-Stage-1 Beobachtung
-- Klassifiziert package_run_integrity_check Jobs in 4 operative Klassen:
--   alive          = Heartbeat aktiv (tick <90s alt), kein Recovery nötig
--   progressing    = läuft, Heartbeat war kürzlich aktiv (<3min)
--   stale_lock    = kein Heartbeat seit >3min ODER recoveries>0
--   sharding_required = >800 approved + (kein tick ODER recoveries>=2)

CREATE OR REPLACE VIEW public.v_integrity_check_heartbeat_health AS
WITH job_data AS (
  SELECT
    j.id AS job_id,
    j.package_id,
    p.title AS package_title,
    j.status,
    j.attempts,
    j.started_at,
    j.created_at,
    EXTRACT(EPOCH FROM (now() - j.started_at))::int AS age_sec,
    (j.meta->>'processing_tick_at')::timestamptz AS last_tick_at,
    CASE 
      WHEN j.meta->>'processing_tick_at' IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (now() - (j.meta->>'processing_tick_at')::timestamptz))::int 
      ELSE NULL 
    END AS tick_age_sec,
    COALESCE((j.meta->>'stale_lock_recoveries')::int, 0) AS recoveries,
    (SELECT COUNT(*) FROM exam_questions eq 
     WHERE eq.curriculum_id = p.curriculum_id AND eq.status='approved') AS approved_q,
    j.meta
  FROM job_queue j
  LEFT JOIN course_packages p ON p.id = j.package_id
  WHERE j.job_type = 'package_run_integrity_check'
)
SELECT
  job_id,
  package_id,
  package_title,
  status,
  approved_q,
  attempts,
  age_sec,
  tick_age_sec,
  recoveries,
  CASE
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'failed' THEN 'failed'
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'pending' THEN 'pending'
    -- processing classifications:
    WHEN approved_q > 800 AND (last_tick_at IS NULL OR recoveries >= 2) THEN 'sharding_required'
    WHEN last_tick_at IS NULL AND age_sec > 60 THEN 'no_heartbeat_yet'
    WHEN tick_age_sec IS NOT NULL AND tick_age_sec < 90 THEN 'alive'
    WHEN tick_age_sec IS NOT NULL AND tick_age_sec < 180 THEN 'progressing'
    WHEN tick_age_sec IS NOT NULL AND tick_age_sec >= 180 THEN 'stale_lock'
    ELSE 'unknown'
  END AS health_class,
  last_tick_at,
  started_at
FROM job_data
ORDER BY 
  CASE status WHEN 'processing' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
  approved_q DESC NULLS LAST;

COMMENT ON VIEW public.v_integrity_check_heartbeat_health IS
'Live-Verifikation für Integrity-Check Heartbeat Stage 1. Health-Klassen: alive (<90s tick), progressing (<3min tick), no_heartbeat_yet (>60s ohne tick), stale_lock (>3min), sharding_required (>800q + repeated recoveries). Trigger Stage 2 wenn sharding_required >0 anhält.';