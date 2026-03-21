
-- ═══════════════════════════════════════════════════════════════
-- Fix: Unblock Industriemechaniker + Steuerfachangestellter
-- ═══════════════════════════════════════════════════════════════

-- 1. Industriemechaniker: Cancel ALL zombie failed jobs
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'failed';

-- 2. Industriemechaniker: Unblock auto_publish step
UPDATE public.package_steps
SET status = 'queued', last_error = NULL, updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'auto_publish'
  AND status = 'blocked';

-- 3. Industriemechaniker: Unblock package → building
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL, updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

-- 4. Steuerfachangestellter: Cancel all failed jobs
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'failed';

-- 5. Steuerfachangestellter: Unblock package → building
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL, updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'blocked';

-- 6. Steuerfachangestellter: Enqueue build_ai_tutor_index + generate_oral_exam
INSERT INTO public.job_queue (job_type, status, attempts, max_attempts, payload, run_after, package_id)
SELECT v.job_type, 'pending', 0, v.max_attempts, v.payload::jsonb, now(), v.pkg_id
FROM (VALUES
  ('package_build_ai_tutor_index', 3,
   '{"package_id":"a9f19137-a004-4850-838a-bdc8f8a705f5","curriculum_id":"97a5a99f-05fb-4328-b298-72268a4b6f84","course_id":"65aec0d4-6ab1-4cfb-9903-b740f6eca626","triggered_by":"manual_unblock"}',
   'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid),
  ('package_generate_oral_exam', 5,
   '{"package_id":"a9f19137-a004-4850-838a-bdc8f8a705f5","curriculum_id":"97a5a99f-05fb-4328-b298-72268a4b6f84","course_id":"65aec0d4-6ab1-4cfb-9903-b740f6eca626","triggered_by":"manual_unblock"}',
   'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid)
) AS v(job_type, max_attempts, payload, pkg_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.job_queue jq
  WHERE jq.package_id = v.pkg_id
    AND jq.job_type = v.job_type
    AND jq.status IN ('pending', 'queued', 'processing')
);

-- 7. Update step status for enqueued steps
UPDATE public.package_steps SET status = 'enqueued', updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key IN ('generate_oral_exam', 'build_ai_tutor_index')
  AND status = 'queued';

-- 8. Audit log
INSERT INTO public.admin_actions (action, payload, affected_ids, scope)
VALUES (
  'manual_unblock_top2',
  '{"reason":"User confirmed unblock for Industriemechaniker + Steuerfachangestellter","fixes":["cancel_zombie_jobs_indmech","unblock_auto_publish_indmech","cancel_failed_steuerfach","unblock_steuerfach","enqueue_oral_tutor_steuerfach"]}'::jsonb,
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c','a9f19137-a004-4850-838a-bdc8f8a705f5'],
  'manual_unblock'
);
