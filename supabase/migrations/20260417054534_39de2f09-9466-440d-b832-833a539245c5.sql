UPDATE public.course_packages
SET status = 'queued',
    blocked_reason = NULL,
    blocked_at = NULL,
    integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
      'bypass_coverage_guard', true,
      'bypass_reason', 'STUDIUM track-drift; release_ok with 2096 approved Q, 10/10 LFs, tutor + handbook present',
      'bypass_at', now(),
      'bypass_by', 'heal_bwl_bachelor_2026_04_17'
    ),
    updated_at = now()
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001';

SELECT public.admin_force_steps_done(
  'a0b0c0d0-0010-4000-8000-000000000001'::uuid,
  ARRAY['generate_lesson_minichecks','validate_lesson_minichecks','run_integrity_check','quality_council','auto_publish']::text[],
  'bwl_bachelor_release_ok_force_publish_after_coverage_bypass',
  true,
  true
);

INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
VALUES (
  'force_publish_bwl_bachelor_release_ok',
  'package',
  jsonb_build_object(
    'package_id','a0b0c0d0-0010-4000-8000-000000000001',
    'release_class','release_ok',
    'approved_questions',2096,
    'covered_lfs','10/10',
    'reason','STUDIUM lesson-coverage bypass; all artifact gates met'
  ),
  ARRAY['a0b0c0d0-0010-4000-8000-000000000001']::text[]
);