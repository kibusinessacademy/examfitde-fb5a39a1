
-- Revive the falsely killed Präzisionswerkzeugmechaniker package
UPDATE course_packages
SET status = 'building', updated_at = now()
WHERE id = '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92'
  AND status = 'failed';
