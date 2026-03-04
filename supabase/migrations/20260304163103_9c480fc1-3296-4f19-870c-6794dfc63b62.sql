
-- Fix retry_count for 11b6 (was 3 from previous heal cycles, should be 0 for fresh start)
UPDATE course_packages SET retry_count = 0 
WHERE id = '11b697be-07a8-4164-ab1b-a8747ec49b03' AND retry_count > 0;

-- Also fix de6c retry_count
UPDATE course_packages SET retry_count = 0 
WHERE id = 'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb' AND retry_count > 0;
