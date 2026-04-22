-- =====================================================================
-- Manual Heal: UNCLASSIFIED_EMPTY (18) + HARD_FAIL_REPAIR_EXHAUSTED (7)
-- =====================================================================

-- 1) UNCLASSIFIED_EMPTY → Failed-Jobs ohne last_error sauber als cancelled
--    markieren (kein echter Fehler, nur Klassifikator-Loop). Pakete bleiben
--    unangetastet; die Pipeline darf sie über reguläre Step-Reentry neu enqueuen.
WITH targets AS (
  SELECT id
  FROM job_queue
  WHERE status = 'failed'
    AND (last_error IS NULL OR btrim(last_error) = '')
)
UPDATE job_queue jq
SET status = 'cancelled',
    last_error = 'UNCLASSIFIED_EMPTY: manuell bereinigt (kein Fehlertext, Klassifikator-Loop)',
    updated_at = now(),
    meta = COALESCE(jq.meta, '{}'::jsonb)
           || jsonb_build_object(
                'manual_heal_at', now(),
                'manual_heal_reason', 'UNCLASSIFIED_EMPTY_cleanup',
                'manual_heal_cluster', 'UNCLASSIFIED_EMPTY'
              )
FROM targets t
WHERE jq.id = t.id;

-- 2) HARD_FAIL_REPAIR_EXHAUSTED → Paket 96d0fb31 (REPAIR_COMPETENCY_COVERAGE)
--    a) terminale validate_exam_pool Jobs cancellen
UPDATE job_queue
SET status = 'cancelled',
    last_error = COALESCE(last_error,'') || ' | manual_heal: superseded by repair_exam_pool_quality',
    updated_at = now(),
    meta = COALESCE(meta,'{}'::jsonb)
           || jsonb_build_object(
                'manual_heal_at', now(),
                'manual_heal_cluster','HARD_FAIL_REPAIR_EXHAUSTED'
              )
WHERE package_id = '96d0fb31-9951-408d-a83e-b2937f5a6af8'
  AND job_type = 'package_validate_exam_pool'
  AND status IN ('failed','pending','processing');

--    b) Audit + Auto-Heal Queue Eintrag, damit Repair sauber dokumentiert ist
INSERT INTO admin_actions (action, scope, payload, affected_ids, user_id)
VALUES (
  'manual_heal.hard_fail_repair_exhausted',
  'package',
  jsonb_build_object(
    'cluster','HARD_FAIL_REPAIR_EXHAUSTED',
    'reason','REPAIR_COMPETENCY_COVERAGE exhausted (7 attempts)',
    'follow_up','enqueue repair_exam_pool_quality + reset validate_exam_pool step'
  ),
  ARRAY['96d0fb31-9951-408d-a83e-b2937f5a6af8']::text[],
  NULL
);

INSERT INTO admin_course_auto_heal_queue
  (package_id, curriculum_id, source, reason_codes, heal_action, status, notes)
SELECT
  cp.id,
  cp.curriculum_id,
  'manual_cockpit',
  ARRAY['HARD_FAIL_REPAIR_EXHAUSTED','REPAIR_COMPETENCY_COVERAGE'],
  'repair_exam_pool_quality',
  'pending',
  'Manuell aus Cockpit getriggert: 7 Repair-Versuche exhausted, gezielter Coverage-Repair angefordert.'
FROM course_packages cp
WHERE cp.id = '96d0fb31-9951-408d-a83e-b2937f5a6af8'
  AND NOT EXISTS (
    SELECT 1 FROM admin_course_auto_heal_queue q
    WHERE q.package_id = cp.id
      AND q.heal_action = 'repair_exam_pool_quality'
      AND q.status IN ('pending','processing')
  );
