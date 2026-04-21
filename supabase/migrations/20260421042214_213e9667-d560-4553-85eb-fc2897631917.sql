-- P0: Finalize zombie auto_seed_exam_blueprints steps for the two re-seeded packages
UPDATE public.package_steps
SET status = 'done',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'finalized_by', 'ops_b1_b3_recovery_p0',
      'finalized_at', now(),
      'reason', 'zombie_step_finished_at_set_but_status_queued',
      'recovery_wave', 'wave15a_b1_b3_p0'
    )
WHERE step_key = 'auto_seed_exam_blueprints'
  AND package_id IN (
    '7472b96f-22ed-493f-9aca-74e70ebcaf8e',
    'e008fc3b-6773-4935-8301-c440470b204c'
  )
  AND status = 'queued'
  AND finished_at IS NOT NULL;

-- Cancel any still-open seeder jobs for these packages to clear step↔job drift
UPDATE public.job_queue
SET status = 'cancelled',
    completed_at = COALESCE(completed_at, now()),
    last_error = COALESCE(last_error, 'obsolete_after_p0_recovery'),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by', 'ops_b1_b3_recovery_p0',
      'cancel_reason', 'step_already_finalized_obsolete_seed_job',
      'recovery_wave', 'wave15a_b1_b3_p0'
    )
WHERE job_type = 'package_auto_seed_exam_blueprints'
  AND status IN ('queued', 'pending_enqueue', 'processing', 'pending')
  AND package_id IN (
    '7472b96f-22ed-493f-9aca-74e70ebcaf8e',
    'e008fc3b-6773-4935-8301-c440470b204c'
  );

-- Audit log
INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
VALUES (
  'p0_zombie_step_finalize',
  'auto_seed_exam_blueprints',
  ARRAY['7472b96f-22ed-493f-9aca-74e70ebcaf8e','e008fc3b-6773-4935-8301-c440470b204c'],
  jsonb_build_object(
    'recovery_wave', 'wave15a_b1_b3_p0',
    'reason', 'finished_at_set_but_status_queued_blocking_causality',
    'next_steps', ARRAY['validate_blueprints', 'package_generate_exam_pool']
  )
);