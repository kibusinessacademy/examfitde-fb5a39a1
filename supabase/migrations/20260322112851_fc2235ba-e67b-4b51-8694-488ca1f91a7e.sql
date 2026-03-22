UPDATE course_packages
SET 
  blocked_reason = NULL,
  status = 'building',
  updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND integrity_passed = true
  AND blocked_reason IS NOT NULL;