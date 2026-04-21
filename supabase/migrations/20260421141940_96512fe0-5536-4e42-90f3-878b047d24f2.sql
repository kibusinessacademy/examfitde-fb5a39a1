-- P0: Park HARD_FAIL Loop-Pakete + Re-Enqueue-Block
-- Cluster 1 (Industriemeister Metall): NO_BLUEPRINTS – echte Seed-Lüge
-- Cluster 2 (FI Systemintegration): REPAIR_COMPETENCY_COVERAGE exhausted

-- 1) Alle laufenden/wartenden Validate-Jobs für diese Pakete cancellen
UPDATE job_queue
SET status='cancelled',
    completed_at=now(),
    last_error='P0_PARK: HARD_FAIL_LOOP — manual_review_required (parked '||now()||')',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'manual_review_required', true,
      'parked_at', now(),
      'parked_reason', 'hard_fail_loop_22_iterations',
      'park_source', 'p0_hard_fail_loop_park'
    )
WHERE job_type='package_validate_exam_pool'
  AND package_id IN ('961103c5-74be-4357-8573-c73862cb09b2','96d0fb31-9951-408d-a83e-b2937f5a6af8')
  AND status IN ('pending','queued','processing','running','batch_pending','failed');

-- 2) Step-Meta: manual_review setzen, damit Re-Enqueue-Guards greifen
UPDATE package_steps
SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'manual_review_required', true,
      'parked_at', now(),
      'parked_reason', CASE 
        WHEN package_id='961103c5-74be-4357-8573-c73862cb09b2' THEN 'HARD_FAIL_NO_BLUEPRINTS'
        WHEN package_id='96d0fb31-9951-408d-a83e-b2937f5a6af8' THEN 'HARD_FAIL_REPAIR_EXHAUSTED'
      END,
      'auto_requeue_blocked', true
    ),
    status='blocked'
WHERE step_key='validate_exam_pool'
  AND package_id IN ('961103c5-74be-4357-8573-c73862cb09b2','96d0fb31-9951-408d-a83e-b2937f5a6af8');

-- 3) Audit
INSERT INTO admin_actions(scope, action, payload, affected_ids)
VALUES (
  'job_queue',
  'p0_hard_fail_loop_park',
  jsonb_build_object(
    'reason','22 identische HARD_FAIL Re-Enqueues in 2.75h trotz HARD_FAIL_BREAKER',
    'cluster_1_no_blueprints', '961103c5-74be-4357-8573-c73862cb09b2',
    'cluster_1_facts','1037 questions, 0 blueprints, 10 LFs — echte Seed-Lüge',
    'cluster_2_repair_exhausted', '96d0fb31-9951-408d-a83e-b2937f5a6af8',
    'cluster_2_facts','1064 questions, 167 blueprints, 13 LFs — Coverage-Repair erschöpft',
    'next_step','Re-Enqueue-Guard härten: manual_review_required==true → block'
  ),
  ARRAY['961103c5-74be-4357-8573-c73862cb09b2','96d0fb31-9951-408d-a83e-b2937f5a6af8']
);