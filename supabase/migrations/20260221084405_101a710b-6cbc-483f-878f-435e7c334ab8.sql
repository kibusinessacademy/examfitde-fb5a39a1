
-- Fix all views missing security_invoker = on
-- This ensures RLS policies of the querying user are enforced, not the view creator

ALTER VIEW public.ops_batch_cursor_stuck SET (security_invoker = on);
ALTER VIEW public.ops_batch_requeue_summary SET (security_invoker = on);
ALTER VIEW public.ops_building_without_job_or_lease SET (security_invoker = on);
ALTER VIEW public.ops_course_build_progress SET (security_invoker = on);
ALTER VIEW public.ops_health_summary SET (security_invoker = on);
ALTER VIEW public.ops_next_step_queued_no_job SET (security_invoker = on);
ALTER VIEW public.ops_package_steps_stuck SET (security_invoker = on);
ALTER VIEW public.ops_pipeline_velocity SET (security_invoker = on);
ALTER VIEW public.ops_prereq_guard_cancelled SET (security_invoker = on);
ALTER VIEW public.ops_processing_stale SET (security_invoker = on);
ALTER VIEW public.ops_processing_unlocked SET (security_invoker = on);
ALTER VIEW public.ops_queued_steps_missing_job SET (security_invoker = on);
ALTER VIEW public.ops_throughput_hourly SET (security_invoker = on);
ALTER VIEW public.pipeline_health SET (security_invoker = on);
ALTER VIEW public.v_competency_heatmap SET (security_invoker = on);
ALTER VIEW public.v_cost_per_package SET (security_invoker = on);
ALTER VIEW public.v_course_content_integrity SET (security_invoker = on);
ALTER VIEW public.v_early_warning SET (security_invoker = on);
ALTER VIEW public.v_pruefungsreife_index SET (security_invoker = on);
