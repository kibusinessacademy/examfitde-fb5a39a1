
-- Elite Reprocessing: Reset all 6 published packages to 'building'
UPDATE public.course_packages
SET 
  status = 'building',
  pipeline_mode = 'factory',
  current_step = 1,
  build_progress = 0,
  step_status_json = jsonb_build_object('auto_seed_exam_blueprints', 'queued'),
  stuck_reason = NULL,
  blocked_reason = NULL,
  last_error = NULL,
  retry_count = 0,
  integrity_passed = false,
  integrity_report = NULL,
  council_approved = false,
  council_approved_at = NULL,
  council_approved_by = NULL,
  quality_report = NULL,
  last_progress_at = now(),
  updated_at = now()
WHERE id IN (
  'e1ef28f6-96ba-4f34-bfee-2d310a0357cb',
  '1983f3ac-a8f1-4c9e-847b-e431535cd79f',
  'a1ede5e9-79f2-4e23-a168-51dffc63dbab',
  'e96bc7b7-0b9d-4da1-8041-494d795dee42',
  '7feb726e-f699-4d42-9cbc-970a650d00a5',
  '3057f0c0-44d7-47dc-90b1-7e2033da7062'
);

-- Audit trail with valid event_type
INSERT INTO public.course_pipeline_events (package_id, course_id, event_type, step_key, message, meta)
SELECT 
  cp.id,
  cp.course_id,
  'started',
  'auto_seed_exam_blueprints',
  'Elite Reprocessing: Paket zurückgesetzt für Elite-Standard-Neugenerierung',
  jsonb_build_object(
    'reason', 'Elevate to Elite standard',
    'previous_status', 'published',
    'triggered_by', 'admin_manual'
  )
FROM public.course_packages cp
WHERE cp.id IN (
  'e1ef28f6-96ba-4f34-bfee-2d310a0357cb',
  '1983f3ac-a8f1-4c9e-847b-e431535cd79f',
  'a1ede5e9-79f2-4e23-a168-51dffc63dbab',
  'e96bc7b7-0b9d-4da1-8041-494d795dee42',
  '7feb726e-f699-4d42-9cbc-970a650d00a5',
  '3057f0c0-44d7-47dc-90b1-7e2033da7062'
);
