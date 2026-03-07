
-- Set MFA package to building for hardening jobs
UPDATE course_packages 
SET status = 'building', last_error = null
WHERE id = '11b697be-07a8-4164-ab1b-a8747ec49b03';
