
-- Heal all 10 critical packages: clean stale jobs, unblock, clear stuck_reasons

-- 1) Unblock Büromanagement fanout step
UPDATE public.package_steps 
SET status = 'queued', 
    meta = COALESCE(meta, '{}'::jsonb) - 'loop_guard_blocked' - 'loop_guard_reason' - 'loop_guard_at'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7' 
  AND step_key = 'fanout_learning_content' AND status = 'blocked';

-- 2) Unblock Büromanagement package
UPDATE public.course_packages 
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7' AND status = 'blocked';

-- 3) Clear stuck_reason for degraded packages
UPDATE public.course_packages 
SET stuck_reason = NULL
WHERE id IN (
  '180c24a9-eba7-4159-ada8-140cee76f947',
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  '1f3fe84a-30a0-40cc-8f36-a7f5678bd285'
)
AND stuck_reason IS NOT NULL;

-- 4) Cancel ALL stale failed jobs for all critical packages
UPDATE public.job_queue 
SET status = 'cancelled', 
    last_error = 'heal-sweep-2024-03-21: ' || COALESCE(LEFT(last_error, 60), 'stale'),
    updated_at = now()
WHERE package_id IN (
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '180c24a9-eba7-4159-ada8-140cee76f947',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1',
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  '1f3fe84a-30a0-40cc-8f36-a7f5678bd285',
  '90afb8b0-9e30-4cc7-a4bc-959fd927d1df',
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab'
)
AND status = 'failed';

-- 5) Audit log
INSERT INTO public.admin_actions (action, scope, payload)
VALUES (
  'heal_10_critical_packages_sweep',
  'pipeline',
  jsonb_build_object(
    'healed_packages', jsonb_build_array(
      '5377ab93 (Büromanagement: unblocked loop_guard)',
      '180c24a9 (IT-System-Elektroniker: cleared stuck)',
      '2e8da39f (Mechatroniker: cleared stuck)',
      '335decc8 (Automatisierung: cleared stuck)',
      '1f3fe84a (Gebäudesystem: cleared stuck)',
      '90afb8b0 (Gebäude+Infra: failed jobs cancelled)',
      'e0d10ecb (Drogist: failed jobs cancelled)',
      '772e30cf (Sozialversicherung: failed jobs cancelled)',
      'fd1d8192 (Betriebstechnik: ok)',
      '9c1b3734 (Industriemechaniker: ok)'
    ),
    'actions', jsonb_build_array(
      'unblocked fanout_learning_content step',
      'reset Büromanagement from blocked to building',
      'cleared 4x stuck_reason',
      'cancelled all stale failed jobs across 8 packages'
    )
  )
);
