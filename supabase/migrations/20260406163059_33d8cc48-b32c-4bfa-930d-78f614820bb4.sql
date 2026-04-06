
-- Grant SELECT on admin ops views that are currently inaccessible
GRANT SELECT ON ops_validate_exam_pool_progress TO authenticated;
GRANT SELECT ON ops_blocked_packages TO authenticated;
GRANT SELECT ON ops_finalization_stall TO authenticated;
GRANT SELECT ON ops_non_building_recoverable TO authenticated;
GRANT SELECT ON ops_build_activity_truth TO authenticated;
GRANT SELECT ON ops_building_without_job_or_lease TO authenticated;
GRANT SELECT ON ops_package_steps_stuck TO authenticated;
GRANT SELECT ON ops_blocked_but_ready TO authenticated;
GRANT SELECT ON ops_throughput_hourly TO authenticated;
GRANT SELECT ON ops_cost_summary TO authenticated;
