-- Reactivate both packages: blocked → building, clear admin_hold
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id IN (
  '3e070545-c555-417a-a047-c7541ebb2a7c',
  '5377ab93-fe17-488c-a266-bdb26b672da7'
);

INSERT INTO public.admin_actions(action, scope, affected_ids, payload)
VALUES (
  'admin_pipeline_resume',
  'course_package',
  ARRAY['3e070545-c555-417a-a047-c7541ebb2a7c','5377ab93-fe17-488c-a266-bdb26b672da7'],
  jsonb_build_object('reason','manual_admin_resume_after_soft_reset','to_status','building')
);