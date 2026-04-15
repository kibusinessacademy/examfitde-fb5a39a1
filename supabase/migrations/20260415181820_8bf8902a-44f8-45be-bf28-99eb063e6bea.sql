
-- Clear invalid blocked_reason taxonomy violation, then activate
UPDATE course_packages
SET blocked_reason = NULL, status = 'building', priority = 1, updated_at = now()
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7'
AND status = 'queued';
