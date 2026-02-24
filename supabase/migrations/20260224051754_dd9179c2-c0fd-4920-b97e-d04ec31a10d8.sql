
-- ═══ ROOT CAUSE A: Governance-Hardening für Blueprint Approval ═══
-- Erzwingt: status='approved' ⇒ approved_at, approved_by NOT NULL
-- Seeder darf nur 'draft' oder 'seeded' setzen; Approval nur via Council/RPC

CREATE OR REPLACE FUNCTION enforce_blueprint_approval_governance()
RETURNS TRIGGER AS $$
BEGIN
  -- Rule 1: If status is being set to 'approved', require audit fields
  IF NEW.status = 'approved' THEN
    IF NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'GOVERNANCE_VIOLATION: Cannot set status=approved without approved_at. Use Council/Publish-RPC.';
    END IF;
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'GOVERNANCE_VIOLATION: Cannot set status=approved without approved_by. Use Council/Publish-RPC.';
    END IF;
  END IF;
  
  -- Rule 2: If status is NOT approved, clear audit fields to prevent stale data
  IF NEW.status != 'approved' THEN
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
    NEW.approved_version_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Attach trigger (BEFORE INSERT OR UPDATE)
DROP TRIGGER IF EXISTS trg_enforce_blueprint_governance ON public.question_blueprints;
CREATE TRIGGER trg_enforce_blueprint_governance
  BEFORE INSERT OR UPDATE ON public.question_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION enforce_blueprint_approval_governance();

-- ═══ RPC: Approve blueprints via Council (the ONLY valid approval path) ═══
CREATE OR REPLACE FUNCTION approve_blueprints_from_council(
  p_blueprint_ids UUID[],
  p_approved_by TEXT DEFAULT 'quality_council'
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE question_blueprints
  SET 
    status = 'approved',
    approved_at = now(),
    approved_by = p_approved_by,
    approved_version_id = gen_random_uuid()::text,
    updated_at = now()
  WHERE id = ANY(p_blueprint_ids)
    AND status IN ('draft', 'seeded', 'pending_review')
    AND question_template IS NOT NULL 
    AND question_template != ''
    AND typical_exam_trap IS NOT NULL;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
