
-- Guard: prevent quality_council done without execution evidence
CREATE OR REPLACE FUNCTION fn_guard_quality_council_requires_execution()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.step_key = 'quality_council'
    AND NEW.status = 'done'
    AND (OLD.status IS DISTINCT FROM 'done')
    AND (NEW.meta->>'executed' IS NULL OR NEW.meta->>'executed' = 'false')
  THEN
    INSERT INTO ops_guardrail_events (guard_key, package_id, step_key, detail)
    VALUES (
      'quality_council_done_without_execution',
      NEW.package_id,
      NEW.step_key,
      jsonb_build_object(
        'blocked_meta', NEW.meta,
        'source', coalesce(NEW.meta->>'finalization_source', 'unknown')
      )
    );
    RAISE WARNING '[guard] quality_council_done_without_execution blocked for %', NEW.package_id;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_quality_council_requires_execution ON package_steps;
CREATE TRIGGER trg_guard_quality_council_requires_execution
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  WHEN (NEW.step_key = 'quality_council')
  EXECUTE FUNCTION fn_guard_quality_council_requires_execution();
