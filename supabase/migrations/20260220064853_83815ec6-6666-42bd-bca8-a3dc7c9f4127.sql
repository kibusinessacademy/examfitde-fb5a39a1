
create or replace view public.ops_queued_steps_missing_job as
select
  ps.package_id,
  cp.title,
  ps.step_key,
  ps.status::text as step_status,
  ps.updated_at as step_updated_at,
  case
    when ps.step_key = 'generate_handbook' then 'package_generate_handbook'
    when ps.step_key = 'validate_handbook' then 'package_validate_handbook'
    when ps.step_key = 'generate_exam_pool' then 'package_generate_exam_pool'
    when ps.step_key = 'validate_exam_pool' then 'package_validate_exam_pool'
    when ps.step_key = 'generate_oral_exam' then 'package_generate_oral_exam'
    when ps.step_key = 'validate_oral_exam' then 'package_validate_oral_exam'
    when ps.step_key = 'generate_learning_content' then 'package_generate_learning_content'
    when ps.step_key = 'validate_learning_content' then 'package_validate_learning_content'
    when ps.step_key = 'build_ai_tutor_index' then 'package_build_ai_tutor_index'
    when ps.step_key = 'validate_tutor_index' then 'package_validate_tutor_index'
    when ps.step_key = 'auto_seed_exam_blueprints' then 'package_auto_seed_exam_blueprints'
    when ps.step_key = 'validate_blueprints' then 'package_validate_blueprints'
    when ps.step_key = 'scaffold_learning_course' then 'package_scaffold_learning_course'
    when ps.step_key = 'run_integrity_check' then 'package_run_integrity_check'
    when ps.step_key = 'quality_council' then 'package_quality_council'
    when ps.step_key = 'auto_publish' then 'package_auto_publish'
    else 'package_' || ps.step_key
  end as expected_job_type
from public.package_steps ps
join public.course_packages cp on cp.id = ps.package_id
where ps.status::text in ('queued', 'enqueued', 'running')
  and not exists (
    select 1
    from public.job_queue jq
    where jq.payload->>'package_id' = ps.package_id::text
      and jq.status::text in ('pending', 'processing')
      and jq.job_type = case
        when ps.step_key = 'generate_handbook' then 'package_generate_handbook'
        when ps.step_key = 'validate_handbook' then 'package_validate_handbook'
        when ps.step_key = 'generate_exam_pool' then 'package_generate_exam_pool'
        when ps.step_key = 'validate_exam_pool' then 'package_validate_exam_pool'
        when ps.step_key = 'generate_oral_exam' then 'package_generate_oral_exam'
        when ps.step_key = 'validate_oral_exam' then 'package_validate_oral_exam'
        when ps.step_key = 'generate_learning_content' then 'package_generate_learning_content'
        when ps.step_key = 'validate_learning_content' then 'package_validate_learning_content'
        when ps.step_key = 'build_ai_tutor_index' then 'package_build_ai_tutor_index'
        when ps.step_key = 'validate_tutor_index' then 'package_validate_tutor_index'
        when ps.step_key = 'auto_seed_exam_blueprints' then 'package_auto_seed_exam_blueprints'
        when ps.step_key = 'validate_blueprints' then 'package_validate_blueprints'
        when ps.step_key = 'scaffold_learning_course' then 'package_scaffold_learning_course'
        when ps.step_key = 'run_integrity_check' then 'package_run_integrity_check'
        when ps.step_key = 'quality_council' then 'package_quality_council'
        when ps.step_key = 'auto_publish' then 'package_auto_publish'
        else 'package_' || ps.step_key
      end
  );
