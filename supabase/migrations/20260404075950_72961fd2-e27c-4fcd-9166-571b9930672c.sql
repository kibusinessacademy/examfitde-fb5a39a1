
-- Clear heal-dispatch leases that are blocking the pipeline-runner
DELETE FROM package_leases WHERE runner_id = 'heal-dispatch';

-- Also clear expired leases
DELETE FROM package_leases WHERE lease_until < now();

-- Increase max_concurrent_packages to match actual building count
UPDATE ops_pipeline_config SET value = '10' WHERE key = 'max_concurrent_packages';

-- Ensure wip_limit allows processing existing packages
UPDATE ops_pipeline_config SET value = '12' WHERE key = 'wip_limit';
