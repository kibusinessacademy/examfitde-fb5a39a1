-- Cluster A: HARD_FAIL_NO_CURRICULUM (2) — requeue failed step instead of force-done
UPDATE package_steps
SET status='queued',
    attempts=0,
    last_error=NULL,
    started_at=NULL,
    finished_at=NULL,
    updated_at=now()
WHERE package_id IN ('d2000000-0010-4000-8000-000000000001','091fb5ed-3bea-5e0b-840e-e07845a5ebc5')
  AND step_key='validate_exam_pool'
  AND status='failed';

UPDATE course_packages
SET status='building', blocked_reason=NULL, blocked_at=NULL, blocked_by=NULL, last_error=NULL, updated_at=now()
WHERE id IN ('d2000000-0010-4000-8000-000000000001','091fb5ed-3bea-5e0b-840e-e07845a5ebc5')
  AND status='blocked';

-- Cluster B: HARD_FAIL_OTHER (2) — clear quality_gate_failed
UPDATE course_packages
SET status='building', blocked_reason=NULL, blocked_at=NULL, last_error=NULL, updated_at=now()
WHERE id IN ('dd000001-0005-4000-8000-000000000001','dd000001-0008-4000-8000-000000000001')
  AND status IN ('blocked','quality_gate_failed');

UPDATE package_steps
SET status='queued', attempts=0, last_error=NULL, updated_at=now()
WHERE package_id IN ('dd000001-0005-4000-8000-000000000001','dd000001-0008-4000-8000-000000000001')
  AND status='failed';

-- Cluster C + Re-Nudge for A+B
DO $$
DECLARE
  pkg uuid;
  result jsonb;
BEGIN
  FOREACH pkg IN ARRAY ARRAY[
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid,
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid,
    'd14ca583-784f-403d-97a4-34a65ffd961d'::uuid,
    'd2000000-0010-4000-8000-000000000001'::uuid,
    '091fb5ed-3bea-5e0b-840e-e07845a5ebc5'::uuid,
    'dd000001-0005-4000-8000-000000000001'::uuid,
    'dd000001-0008-4000-8000-000000000001'::uuid
  ] LOOP
    BEGIN
      SELECT public.admin_nudge_atomic_trigger(pkg, 'manual_bulk_unblock_2026_04_29') INTO result;
      RAISE NOTICE 'Nudged %: %', pkg, result;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Nudge failed for %: %', pkg, SQLERRM;
    END;
  END LOOP;
END $$;
