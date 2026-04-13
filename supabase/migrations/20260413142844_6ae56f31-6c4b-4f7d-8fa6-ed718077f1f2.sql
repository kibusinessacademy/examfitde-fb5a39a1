
-- 1) Demote prio-2 building packages to free WIP slots for prio-1
UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'intentional_pause',
    stuck_reason = 'WIP priority demotion: prio-2 building while prio-1 packages still blocked',
    updated_at = now()
WHERE priority >= 2
  AND status = 'building';

-- 2) Cancel all jobs for demoted packages
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'WIP_PRIORITY_DEMOTION: prio-2 package demoted to free slots for prio-1',
    completed_at = now(),
    updated_at = now()
WHERE package_id IN (
  SELECT id FROM course_packages WHERE priority >= 2 AND status = 'blocked' AND blocked_reason = 'intentional_pause' AND stuck_reason LIKE 'WIP priority demotion%'
)
AND status IN ('pending', 'processing');

-- 3) Unblock prio-1 packages that are on intentional_pause or auto_heal_zombie
UPDATE course_packages
SET status = 'queued',
    blocked_reason = NULL,
    stuck_reason = NULL,
    updated_at = now()
WHERE priority <= 1
  AND status = 'blocked'
  AND blocked_reason IN ('intentional_pause', 'auto_heal_zombie');
