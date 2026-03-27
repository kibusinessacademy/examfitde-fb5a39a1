
-- Fix Steuerfach: First invalidate integrity (quarantine verdict means it shouldn't be passed)
-- Then set blocked status
UPDATE course_packages
SET integrity_passed = false
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5';

UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'ELITE_QUALITY_GATE_FAILED: hollow_published_auto_quarantine'
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5';
