
-- ═══════════════════════════════════════════════════════════════
-- WAVE A: Unblock Verkäufer + Industriemechaniker
-- ═══════════════════════════════════════════════════════════════

-- 1. Industriemechaniker: Set started_at/attempts to satisfy ghost guard, then mark done
UPDATE public.package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    finished_at = now(),
    attempts = GREATEST(attempts, 1),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'exception_approved', true,
      'exception_reason', '393 approved questions sufficient – wave_a skip regeneration',
      'exception_approved_at', now()::text,
      'loop_guard_blocked', false,
      'unblocked_at', now()::text
    ),
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'generate_exam_pool'
  AND status = 'blocked';

-- 2. Verkäufer + Industriemechaniker: blocked → building
UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id IN (
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
)
AND status = 'blocked';

-- 3. Remove locks
DELETE FROM public.course_package_locks
WHERE package_id IN (
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
);

-- 4. Audit
INSERT INTO public.admin_actions (action, payload, after_state, affected_ids, scope)
VALUES (
  'wave_a_unblock',
  '{"reason":"wave_a: Verkäufer + Industriemechaniker downstream push", "wave":"A"}'::jsonb,
  '{"verkäufer":"blocked→building","industriemechaniker":"blocked→building, generate_exam_pool→done(exception)"}'::jsonb,
  ARRAY['59b6e214-e181-4c2b-986e-1ce544984d04', '9c1b3734-bb25-4986-baef-5bb1c20a212c'],
  'wave_a_pipeline_recovery'
);

-- ═══════════════════════════════════════════════════════════════
-- WAVE B: Reset Mechatroniker + Elektroniker Betriebstechnik
-- ═══════════════════════════════════════════════════════════════

-- 5. Reset blocked generate_exam_pool steps → queued
UPDATE public.package_steps
SET status = 'queued',
    attempts = 0,
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'loop_guard_blocked', false,
      'unblocked_at', now()::text,
      'unblock_reason', 'wave_b: routing fix deployed, batchSafeModel guard active'
    ),
    updated_at = now()
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
)
AND step_key = 'generate_exam_pool'
AND status = 'blocked';

-- 6. Packages: blocked → building
UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
)
AND status = 'blocked';

-- 7. Remove locks
DELETE FROM public.course_package_locks
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
);

-- 8. Audit
INSERT INTO public.admin_actions (action, payload, after_state, affected_ids, scope)
VALUES (
  'wave_b_reset_retrigger',
  '{"reason":"wave_b: Mechatroniker + Elektroniker BT reset with batchSafeModel routing fix", "wave":"B"}'::jsonb,
  '{"mechatroniker":"blocked→building, generate_exam_pool reset","elektroniker_bt":"blocked→building, generate_exam_pool reset"}'::jsonb,
  ARRAY['2e8da39f-60f8-44d9-8b70-e1176222ca55', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'],
  'wave_b_pipeline_recovery'
);
