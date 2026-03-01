-- View: latest active package per course (prevents duplicate listings)
-- Returns only the newest non-archived package for each course_id.
CREATE OR REPLACE VIEW public.v_latest_course_package AS
SELECT DISTINCT ON (cp.course_id) 
  cp.*
FROM course_packages cp
WHERE cp.status != 'archived'
  AND cp.course_id IS NOT NULL
ORDER BY cp.course_id, cp.created_at DESC;