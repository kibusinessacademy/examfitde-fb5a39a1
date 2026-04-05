
-- ═══════════════════════════════════════════════════════
-- 1. Temporarily disable seal guards for data repair
-- ═══════════════════════════════════════════════════════
ALTER TABLE lessons DISABLE TRIGGER guard_sealed_lessons;

-- 2. Promote tier1_passed lessons: draft → approved
UPDATE lessons
SET status = 'approved',
    quality_gate_status = 'passed'
WHERE module_id IN (
  SELECT id FROM modules WHERE course_id = 'ac7cb4ea-df75-4549-956d-d5a6d31d1575'
)
AND status = 'draft'
AND qc_status = 'tier1_passed';

-- 3. Mark failed lessons correctly
UPDATE lessons
SET quality_gate_status = 'failed'
WHERE module_id IN (
  SELECT id FROM modules WHERE course_id = 'ac7cb4ea-df75-4549-956d-d5a6d31d1575'
)
AND status = 'draft'
AND qc_status IN ('tier1_failed', 'needs_revision');

-- 4. Fix already-approved lesson
UPDATE lessons
SET quality_gate_status = 'passed'
WHERE module_id IN (
  SELECT id FROM modules WHERE course_id = 'ac7cb4ea-df75-4549-956d-d5a6d31d1575'
)
AND qc_status = 'approved'
AND quality_gate_status = 'pending';

-- 5. Re-enable seal guards
ALTER TABLE lessons ENABLE TRIGGER guard_sealed_lessons;

-- ═══════════════════════════════════════════════════════
-- 6. Council Consistency Guard (prevents future mismatches)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION guard_council_consistency()
RETURNS trigger AS $$
BEGIN
  -- Block setting council_approved = true unless quality_council step is done
  IF NEW.council_approved = true AND (OLD.council_approved IS DISTINCT FROM true) THEN
    IF NOT EXISTS (
      SELECT 1 FROM package_steps
      WHERE package_id = NEW.id
        AND step_key = 'quality_council'
        AND status = 'done'
    ) THEN
      RAISE EXCEPTION 'COUNCIL_CONSISTENCY: Cannot set council_approved=true without quality_council step being done';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_council_consistency ON course_packages;
CREATE TRIGGER trg_guard_council_consistency
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  WHEN (NEW.council_approved = true AND OLD.council_approved IS DISTINCT FROM true)
  EXECUTE FUNCTION guard_council_consistency();
