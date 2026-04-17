-- =====================================================
-- MULTI-HEAL P5 v2 — Reclassified Textilreiniger to release_block
-- =====================================================
-- Hollow-Publish Guard hat korrekt blockiert (235qs<500, LF_COVERAGE_GAP)
-- → Reconcile only, KEIN Force-Publish

-- 1. Textilreiniger: nur Pipeline-Tail reconciln, status bleibt building
DO $$
BEGIN
  PERFORM public.admin_force_steps_done(
    p_package_id := '01099a37-3309-4bc1-a2ce-6a6913e4d125'::uuid,
    p_step_keys := ARRAY['quality_council','run_integrity_check','auto_publish'],
    p_reason := 'multi_heal_p5_v2: textilreiniger reconcile pipeline tail (no publish — release_block: 235<500qs, LF_COVERAGE_GAP)',
    p_emergency_bypass := true,
    p_force_publish := false
  );
END$$;

-- 2. Schifffahrtskaufmann
UPDATE public.course_packages
SET status = 'blocked',
    blocked_reason = 'content_gap',
    blocked_at = COALESCE(blocked_at, now()),
    stuck_reason = 'multi_heal_p5: only 59/500 approved questions — HARD_FAIL_REPAIR_EXHAUSTED, manual content regen required',
    last_error = 'content_gap: 59 approved questions far below 500 threshold (12% coverage)'
WHERE id = '8acce74a-4f16-4589-a9b3-1b3c37961404';

-- 3. Immobilienverwalter IHK — komplett leer
UPDATE public.course_packages
SET status = 'blocked',
    blocked_reason = 'content_gap',
    blocked_at = COALESCE(blocked_at, now()),
    stuck_reason = 'multi_heal_p5: empty package - 0 lessons, 0 questions, 0 chapters - requires full content regeneration',
    last_error = 'content_gap: package has no lessons, no questions, no chapters'
WHERE id = 'd2000000-0011-4000-8000-000000000001';

-- 4. ZOMBIE-JOB KILL: 4ca4851a (4.7h stale, blockiert content-runner ständig)
UPDATE public.job_queue
SET status = 'cancelled',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = COALESCE(last_error,'') || ' | multi_heal_p5_v2: zombie cancelled — pipeline tail reconciled',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'cancelled_by','multi_heal_p5_v2',
      'reason','zombie_blocking_content_runner',
      'cancelled_at', now()::text
    )
WHERE id = '4ca4851a-3c60-4302-b9a5-67bdd43013d1'
  AND status = 'processing';

-- 5. Cancel obsolete jobs for the 3 packages
UPDATE public.job_queue
SET status = 'cancelled',
    completed_at = now(),
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'cancelled_by','multi_heal_p5_v2',
      'reason','superseded_by_admin_force_or_content_gap'
    )
WHERE package_id IN (
  '01099a37-3309-4bc1-a2ce-6a6913e4d125',
  '8acce74a-4f16-4589-a9b3-1b3c37961404',
  'd2000000-0011-4000-8000-000000000001'
) AND status IN ('pending','queued','processing','batch_pending','failed');

-- 6. Systemweiter Sweep: stale processing >30min → failed
UPDATE public.job_queue
SET status = 'failed',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = COALESCE(last_error,'') || ' | multi_heal_p5_sweep: cancelled stale processing >30min',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'cancelled_by','multi_heal_p5_sweep',
      'reason','stale_processing_over_30min'
    )
WHERE status = 'processing'
  AND locked_at < now() - interval '30 minutes';

-- 7. Audit
INSERT INTO public.admin_actions (action, scope, payload, user_id)
VALUES (
  'multi_heal_p5_v2_runner_zombie_fix',
  '3_packages_plus_runner_recovery',
  jsonb_build_object(
    'group_a_reconciled_release_block', ARRAY['01099a37-3309-4bc1-a2ce-6a6913e4d125'],
    'group_b_blocked_content_gap', ARRAY[
      '8acce74a-4f16-4589-a9b3-1b3c37961404',
      'd2000000-0011-4000-8000-000000000001'
    ],
    'zombie_job_killed', '4ca4851a-3c60-4302-b9a5-67bdd43013d1',
    'evidence', jsonb_build_object(
      'textilreiniger_qs_approved', 235,
      'textilreiniger_release_class', 'release_block',
      'textilreiniger_codes', ARRAY['LF_COVERAGE_GAP','APPROVED_Q<500'],
      'schifffahrt_qs_approved', 59,
      'immobilien_lessons', 0,
      'runner_diagnosis', 'content-runner stuck on zombie 4.7h, completion_rate=0 for 25min'
    )
  ),
  NULL
);