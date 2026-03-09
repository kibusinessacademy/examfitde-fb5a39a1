
-- Restore Verkäufer to building status (was set to blocked by trigger when step was reset)
UPDATE course_packages 
SET status = 'building', updated_at = now()
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';
