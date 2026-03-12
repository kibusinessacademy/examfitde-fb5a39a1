
-- Unblock all 5 prio-1 packages: set to queued so runner properly acquires leases
UPDATE course_packages 
SET status = 'queued', 
    blocked_reason = NULL, 
    updated_at = now()
WHERE id IN (
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
)
AND status = 'blocked';
