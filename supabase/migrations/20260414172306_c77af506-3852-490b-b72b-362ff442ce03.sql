UPDATE course_packages
SET status = 'building',
    updated_at = now()
WHERE id = '63bd9116-a679-4c9d-883d-0e6f4e5147be'
  AND status = 'queued'
  AND blocked_reason IS NULL;