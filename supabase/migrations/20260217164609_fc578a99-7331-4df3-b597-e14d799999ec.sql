-- Fix 1: pipeline_health view – count 'published' as done
CREATE OR REPLACE VIEW pipeline_health AS
SELECT 
  (SELECT count(*) FROM package_leases WHERE lease_until > now()) AS active_leases,
  (SELECT count(*) FROM package_steps WHERE status = 'running'::step_status) AS running_steps,
  (SELECT count(*) FROM course_packages WHERE status = 'queued') AS queued_packages,
  (SELECT count(*) FROM course_packages WHERE status = 'building') AS building_packages,
  (SELECT count(*) FROM course_packages WHERE status = 'failed') AS failed_packages,
  (SELECT count(*) FROM course_packages WHERE status IN ('done','published')) AS done_packages,
  (SELECT count(*) FROM course_packages WHERE status = 'blocked') AS blocked_packages;

-- Fix 2: Industriekaufmann build_progress still at 55 despite published
UPDATE course_packages SET build_progress = 100 WHERE status = 'published' AND build_progress < 100;
