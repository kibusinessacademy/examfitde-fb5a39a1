
-- ═══════════════════════════════════════════════════════════════
-- Autofix: Industriemechaniker — regenerate 22 tier1_failed + 3 needs_revision lessons + 2 minichecks
-- ═══════════════════════════════════════════════════════════════

-- 1. Reset content generation steps to re-process failed lessons
-- (tier1_failed lessons override idempotency guards per artefakt-orchestrierung policy)
UPDATE public.package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, last_error = NULL, updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key IN ('generate_learning_content', 'generate_lesson_minichecks', 'validate_learning_content', 'finalize_learning_content');

-- 2. Reset integrity + auto_publish for re-evaluation after fix
UPDATE public.package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, last_error = NULL,
    meta = '{}'::jsonb, updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key IN ('run_integrity_check', 'auto_publish');

-- 3. Unblock package: clear blocked_reason so orchestrator picks it up
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL, updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

-- 4. Cancel any stale failed/cancelled jobs to avoid zombie noise
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'failed';

-- 5. Audit trail
INSERT INTO public.admin_actions (action, payload, affected_ids, scope)
VALUES (
  'autofix_tier1_failed_lessons',
  '{"reason":"Regenerate 22 tier1_failed + 3 needs_revision lessons + 2 missing minichecks for Industriemechaniker","steps_reset":["generate_learning_content","generate_lesson_minichecks","validate_learning_content","finalize_learning_content","run_integrity_check","auto_publish"]}'::jsonb,
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c'],
  'autofix'
);
