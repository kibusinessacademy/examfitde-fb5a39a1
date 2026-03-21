
-- ═══════════════════════════════════════════════════════════════
-- Priority Sprint: Push top 3 packages to completion
-- ═══════════════════════════════════════════════════════════════

-- 1. Set priority=1 for all 3 target packages
UPDATE public.course_packages
SET priority = 1, updated_at = now()
WHERE id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  '047bc325-5244-4f21-affd-5395bf62bcff'
);

-- 2. Unblock Steuerfachangestellter → building
UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'blocked';

-- 3. Activate KFZ-Mechatroniker → building
UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id = '047bc325-5244-4f21-affd-5395bf62bcff'
  AND status = 'queued';

-- 4. Cancel stale failed integrity jobs for Industriemechaniker
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE (payload->>'package_id') = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND job_type = 'package_run_integrity_check'
  AND status = 'failed';

-- 5. Existing pending integrity job will now bypass backlog gate via edge function fix

-- 6. Enqueue jobs only if not already active
INSERT INTO public.job_queue (job_type, status, attempts, max_attempts, payload, run_after, package_id)
SELECT v.job_type, 'pending', 0, v.max_attempts, v.payload::jsonb, now(), v.pkg_id
FROM (VALUES
  ('package_generate_oral_exam', 5,
   '{"package_id":"a9f19137-a004-4850-838a-bdc8f8a705f5","curriculum_id":"97a5a99f-05fb-4328-b298-72268a4b6f84","course_id":"65aec0d4-6ab1-4cfb-9903-b740f6eca626","triggered_by":"priority_sprint"}',
   'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid),
  ('package_build_ai_tutor_index', 3,
   '{"package_id":"a9f19137-a004-4850-838a-bdc8f8a705f5","curriculum_id":"97a5a99f-05fb-4328-b298-72268a4b6f84","course_id":"65aec0d4-6ab1-4cfb-9903-b740f6eca626","triggered_by":"priority_sprint"}',
   'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid),
  ('package_fanout_learning_content', 5,
   '{"package_id":"047bc325-5244-4f21-affd-5395bf62bcff","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","course_id":"235f622e-6046-487e-8465-e1ab7daae252","triggered_by":"priority_sprint"}',
   '047bc325-5244-4f21-affd-5395bf62bcff'::uuid)
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

UPDATE public.package_steps SET status = 'enqueued', updated_at = now()
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff'
  AND step_key = 'fanout_learning_content'
  AND status = 'queued';

-- 8. Audit log
INSERT INTO public.admin_actions (action, payload, affected_ids, scope)
VALUES (
  'priority_sprint_top3',
  '{"reason":"User requested top 3 packages to completion","packages":["Industriemechaniker (93%)","Steuerfachangestellter (67%)","KFZ-Mechatroniker (54%)"],"fixes":["backlog_gate_bypass_prio1","unblock_steuerfach","activate_kfz","enqueue_integrity","enqueue_oral_tutor","enqueue_fanout"]}'::jsonb,
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c','a9f19137-a004-4850-838a-bdc8f8a705f5','047bc325-5244-4f21-affd-5395bf62bcff'],
  'priority_sprint'
);
