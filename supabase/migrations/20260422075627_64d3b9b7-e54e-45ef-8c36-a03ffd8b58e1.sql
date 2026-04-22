WITH heal_targets AS (
  SELECT DISTINCT ON (package_id, job_type)
    id, job_type, package_id, priority, max_attempts, meta, last_error, payload
  FROM job_queue WHERE status='failed' AND package_id IS NOT NULL
  ORDER BY package_id, job_type, updated_at DESC
),
classified AS (
  SELECT *,
    CASE
      WHEN last_error LIKE '%STALE_LOCK%' OR last_error LIKE '%stale_lock%' THEN 90
      WHEN last_error LIKE '%REPAIR_%' OR last_error LIKE '%repair_%' THEN 120
      WHEN last_error LIKE '%REQUEUE_LOOP%' OR last_error LIKE '%requeue_loop%' THEN 180
      WHEN last_error LIKE '%QUALITY_THRESHOLD%' OR last_error LIKE '%quality_re_eval%' THEN 300
      WHEN last_error LIKE '%NO_CURRICULUM%' OR last_error LIKE '%no_curr%' THEN 60
      WHEN last_error LIKE '%non_building%' THEN 30
      ELSE 60
    END AS cooldown_sec
  FROM heal_targets
)
INSERT INTO job_queue (job_type, package_id, status, priority, max_attempts, attempts, run_after, meta, lane, payload)
SELECT 
  c.job_type, c.package_id, 'pending', c.priority, c.max_attempts, 0,
  now() + (c.cooldown_sec || ' seconds')::interval,
  COALESCE(c.meta,'{}'::jsonb) 
    - 'stale_lock_recoveries' - 'last_qg_fail' - 'per_type_cap' 
    - 'per_type_cap_deferred_at' - 'deferred_at' - 'deferred_by' 
    - 'deferred_reason' - 'repair_attempts' - 'last_recovery_at'
    || jsonb_build_object(
      'manual_heal_at', now(),
      'manual_heal_reason', 'systemwide_failed_queue_heal_v2',
      'cloned_from', c.id
    ),
  CASE WHEN c.job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish') 
       THEN 'control' ELSE 'build' END,
  COALESCE(c.payload, jsonb_build_object('package_id', c.package_id))
FROM classified c
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue jq
  WHERE jq.package_id = c.package_id AND jq.job_type = c.job_type
    AND jq.status IN ('pending','processing','queued')
);

-- Cancel ALL failed jobs (sowohl die geklonten als auch die Duplikate)
UPDATE job_queue SET status='cancelled',
  last_error = COALESCE(last_error,'') || ' | auto_heal_v2: superseded',
  updated_at = now()
WHERE status='failed';

UPDATE course_packages SET status='building', updated_at=now()
WHERE id = '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081' AND status IN ('queued','blocked');

INSERT INTO admin_actions (action, scope, payload)
VALUES ('systemwide_failed_queue_heal_v2_clone','job_queue',
  jsonb_build_object('timestamp', now(), 'strategy','clone_dedup_then_cancel'));

INSERT INTO admin_notifications (title, body, category, severity, metadata)
VALUES ('🔧 Failed-Queue Heal v2 abgeschlossen',
  'Failed-Jobs nach (package_id, job_type) dedupliziert und als frische Pending-Jobs geklont. Originals cancelled.',
  'ops','info', jsonb_build_object('kind','manual_failed_heal_v2','timestamp', now()));