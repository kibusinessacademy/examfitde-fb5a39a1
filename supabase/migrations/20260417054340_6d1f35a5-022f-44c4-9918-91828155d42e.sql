UPDATE public.course_packages
SET blocked_reason = NULL,
    blocked_at = NULL,
    status = 'queued',
    integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
      'manual_unblock_at', now(),
      'manual_unblock_by', 'heal_personalfachk_2026_04_17_phase2',
      'manual_unblock_reason', 'cleared blocked_reason to allow pool re-generation worker'
    ),
    updated_at = now()
WHERE id = '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9';

INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
VALUES (
  'manual_unblock_personalfachkaufmann_phase2',
  'package',
  jsonb_build_object(
    'package_id','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
    'cleared','blocked_reason+blocked_at',
    'old_blocked_reason','pipeline_repair_required'
  ),
  ARRAY['176f51ad-fe34-596e-9b3d-d1c9cd23b0a9']::text[]
);