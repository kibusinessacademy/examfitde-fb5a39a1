
-- Fix Steuerfach: current status is published, needs quality_gate_failed
UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'ELITE_QUALITY_GATE_FAILED: hollow_published_auto_quarantine'
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'published';
