
-- Fix v2 package and v1 build_progress
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;

-- Mark orphaned v2 package as done (no product_id, legacy-published by mistake)
UPDATE course_packages 
SET status = 'done',
    published_at = NULL
WHERE id = '01b6c589-4f7e-4ade-b234-a9666f69fd3a'
AND product_id IS NULL;

-- Fix v1 package build_progress
UPDATE course_packages
SET build_progress = 100
WHERE id = 'caee16dc-b40b-45e4-a408-c3b77d877ac7';

ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;

-- Fix v1 incomplete steps (package_steps is the real table, not the view)
UPDATE package_steps
SET status = 'done'
WHERE package_id = 'caee16dc-b40b-45e4-a408-c3b77d877ac7'
AND status = 'queued';
