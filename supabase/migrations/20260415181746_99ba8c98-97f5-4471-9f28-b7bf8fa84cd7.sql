
UPDATE course_packages
SET status = 'building', priority = 1, updated_at = now()
WHERE id IN (
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '8acce74a-4f16-4589-a9b3-1b3c37961404',
  'd7fd81c3-283e-4270-acef-812b08501442'
)
AND status = 'queued';
