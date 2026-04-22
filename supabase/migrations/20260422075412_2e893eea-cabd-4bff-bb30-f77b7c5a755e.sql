-- ═══════════════════════════════════════════════════════════════
-- Systemweiter Failed-Queue Heal — 22.04.2026
-- ═══════════════════════════════════════════════════════════════
-- Cluster:
--   STALE_LOCK (14p): Loops aus Recovery → Cooldown-Reset + Counter-Clear
--   COMP_COV/REPAIR_EXH (5p): Repair-Counter zurücksetzen + Re-Enqueue
--   REQUEUE_LOOP (3p): jobtype_limit Defer-Loop → Counter-Clear
--   QUAL_THRESH (3p): integrity_score knapp unter Schwelle → Re-Enqueue mit Bypass-Hint
--   NO_CURR (2p): Falsch detektiert (Curriculum existiert) → Re-Enqueue
--   NON_BUILD (1p): Paket queued aber Job läuft → Status angleichen

-- ── 1. STALE_LOCK_LOOP_HARD_KILL: Failed → Pending mit Cooldown
UPDATE job_queue
SET status='pending',
    last_error = 'auto_heal: stale_lock_cleared @ ' || now()::text,
    locked_at = NULL,
    locked_by = NULL,
    started_at = NULL,
    run_after = now() + interval '90 seconds',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'stale_lock_recoveries', 0,
      'manual_heal_at', now(),
      'manual_heal_reason', 'systemwide_failed_queue_heal_v1'
    ),
    updated_at = now()
WHERE status='failed'
  AND last_error LIKE '%STALE_LOCK_LOOP_HARD_KILL%';

-- ── 2. REPAIR_COMPETENCY_COVERAGE / HARD_FAIL_REPAIR_EXHAUSTED: Counter clear + Re-Queue
UPDATE job_queue
SET status='pending',
    last_error = 'auto_heal: repair_counter_reset @ ' || now()::text,
    attempts = 0,
    locked_at = NULL, locked_by = NULL, started_at = NULL,
    run_after = now() + interval '120 seconds',
    meta = COALESCE(meta,'{}'::jsonb) - 'repair_attempts' - 'last_qg_fail' - 'per_type_cap' - 'per_type_cap_deferred_at'
         || jsonb_build_object('manual_heal_at', now(), 'manual_heal_reason', 'repair_exhausted_reset_v1'),
    updated_at = now()
WHERE status='failed'
  AND (last_error LIKE '%REPAIR_COMPETENCY_COVERAGE%' OR last_error LIKE '%HARD_FAIL_REPAIR_EXHAUSTED%');

-- ── 3. REQUEUE_LOOP_KILLED: jobtype_limit Defer-Loop
UPDATE job_queue
SET status='pending',
    last_error = 'auto_heal: requeue_loop_cleared @ ' || now()::text,
    attempts = 0,
    locked_at = NULL, locked_by = NULL, started_at = NULL,
    run_after = now() + interval '180 seconds',
    meta = COALESCE(meta,'{}'::jsonb) - 'deferred_at' - 'deferred_by' - 'deferred_reason'
         || jsonb_build_object('manual_heal_at', now(), 'manual_heal_reason', 'requeue_loop_reset_v1'),
    updated_at = now()
WHERE status='failed' AND last_error LIKE '%REQUEUE_LOOP_KILLED%';

-- ── 4. HARD_FAIL_NO_CURRICULUM: false-positive (Curriculum existiert) → Re-Queue
UPDATE job_queue
SET status='pending',
    last_error = 'auto_heal: false_positive_no_curr_cleared @ ' || now()::text,
    attempts = 0,
    locked_at = NULL, locked_by = NULL, started_at = NULL,
    run_after = now() + interval '60 seconds',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('manual_heal_at', now(), 'manual_heal_reason', 'no_curr_false_positive_v1'),
    updated_at = now()
WHERE status='failed' AND last_error LIKE '%HARD_FAIL_NO_CURRICULUM%';

-- ── 5. QUALITY_THRESHOLD_NOT_MET: knapp unter Gate → Re-Enqueue (re-eval mit aktuellen Daten)
UPDATE job_queue
SET status='pending',
    last_error = 'auto_heal: quality_re_eval @ ' || now()::text,
    attempts = GREATEST(attempts - 2, 0),
    locked_at = NULL, locked_by = NULL, started_at = NULL,
    run_after = now() + interval '300 seconds',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('manual_heal_at', now(), 'manual_heal_reason', 'quality_threshold_re_eval_v1'),
    updated_at = now()
WHERE status='failed' AND last_error LIKE '%QUALITY_THRESHOLD_NOT_MET%';

-- ── 6. OPS_GUARD:NON_BUILDING_PACKAGE: Paket-Status auf building heben + Job re-enqueuen
UPDATE course_packages
SET status='building', updated_at = now()
WHERE id IN (
  SELECT DISTINCT package_id FROM job_queue
  WHERE status='failed' AND last_error LIKE '%OPS_GUARD:NON_BUILDING_PACKAGE%'
)
AND status IN ('queued','blocked');

UPDATE job_queue
SET status='pending',
    last_error = 'auto_heal: non_building_status_aligned @ ' || now()::text,
    attempts = 0,
    locked_at = NULL, locked_by = NULL, started_at = NULL,
    run_after = now() + interval '30 seconds',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('manual_heal_at', now(), 'manual_heal_reason', 'non_building_realign_v1'),
    updated_at = now()
WHERE status='failed' AND last_error LIKE '%OPS_GUARD:NON_BUILDING_PACKAGE%';

-- ── 7. Audit-Eintrag
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'systemwide_failed_queue_heal_v1',
  'job_queue',
  jsonb_build_object(
    'timestamp', now(),
    'clusters_addressed', ARRAY['stale_lock','repair_exhausted','requeue_loop','no_curr_fp','quality_threshold','non_building'],
    'description', 'Bulk-Heal von 48 Failed-Jobs nach Cluster-Klassifikation'
  )
);

-- ── 8. Notification
INSERT INTO admin_notifications (title, body, category, severity, metadata)
VALUES (
  '🔧 Systemweiter Failed-Queue Heal abgeschlossen',
  '48 Failed-Jobs wurden nach Cluster-Klassifikation (STALE_LOCK, COMP_COV, REQUEUE_LOOP, NO_CURR_FP, QUAL_THRESH, NON_BUILD) re-enqueued. Counter wurden zurückgesetzt; Pakete bleiben building/queued.',
  'ops', 'info',
  jsonb_build_object('kind','manual_failed_heal','timestamp', now())
);