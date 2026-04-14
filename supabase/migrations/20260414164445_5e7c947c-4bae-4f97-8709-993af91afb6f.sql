
-- Cancel all premature downstream jobs for packages with < 20% build progress
-- These were incorrectly created during the full pipeline reset
UPDATE job_queue jq
SET 
  status = 'cancelled',
  meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
    'cancel_reason', 'PREMATURE_ENQUEUE_CLEANUP',
    'transition_source', 'admin_governance_fix',
    'transition_at', now()::text
  ),
  updated_at = now()
FROM course_packages cp
WHERE cp.id = jq.package_id
  AND jq.status = 'pending'
  AND cp.build_progress < 20
  AND jq.job_type IN (
    'package_validate_blueprints','package_validate_exam_pool','package_validate_tutor_index',
    'package_build_ai_tutor_index','package_elite_harden','package_run_integrity_check',
    'package_quality_council','package_auto_publish','package_repair_exam_pool_quality',
    'package_validate_blueprint_variants','package_promote_blueprint_variants',
    'package_generate_exam_pool','package_validate_oral_exam','package_generate_oral_exam'
  );

-- Log this cleanup
INSERT INTO admin_actions (user_id, action, scope, payload) VALUES (
  'b0dbd616-9b93-47c8-83c5-39290130a6ea',
  'cancel_premature_downstream_jobs',
  'job_queue',
  '{"reason": "Pipeline reset created jobs for all steps ignoring DAG ordering", "affected_job_types": 14, "estimated_count": 86}'::jsonb
);
