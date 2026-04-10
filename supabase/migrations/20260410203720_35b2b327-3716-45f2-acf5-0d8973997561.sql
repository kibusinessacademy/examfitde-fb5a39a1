
-- 1. Delete all ai_generation_requests
DELETE FROM ai_generation_requests;

-- 2. Pause all building packages EXCEPT the top 5 by build_progress
UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'intentional_pause',
    updated_at = now()
WHERE status = 'building'
  AND id NOT IN (
    SELECT id FROM course_packages
    WHERE status = 'building'
    ORDER BY build_progress DESC NULLS LAST, priority ASC NULLS LAST
    LIMIT 5
  );
