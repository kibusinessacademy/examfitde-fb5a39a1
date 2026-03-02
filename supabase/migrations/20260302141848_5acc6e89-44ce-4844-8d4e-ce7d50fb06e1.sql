
-- Systemischer Guard: Verhindert dass Platzhalter-Content als "approved" in content_versions gespeichert wird
-- Dies behebt den Root-Cause-Bug der PKA v2 Hollow Completion

CREATE OR REPLACE FUNCTION guard_content_version_placeholder_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only check on approved status
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- Block if content_json contains _placeholder: true
  IF NEW.content_json IS NOT NULL AND (NEW.content_json->>'_placeholder')::boolean IS TRUE THEN
    RAISE EXCEPTION 'PLACEHOLDER_APPROVAL_BLOCKED: Cannot approve content_version with _placeholder=true. Content must be generated first. (lesson_id=%, agent=%)',
      NEW.lesson_id, NEW.created_by_agent;
  END IF;

  -- Block if content is suspiciously short (< 1000 chars) for lesson content
  -- Exception: minichecks and non-lesson entities can be shorter
  IF NEW.entity_type IN ('lesson_step', 'lesson') 
     AND NEW.content_json IS NOT NULL 
     AND length(NEW.content_json::text) < 1000 THEN
    RAISE EXCEPTION 'SHORT_CONTENT_APPROVAL_BLOCKED: Cannot approve lesson content_version with less than 1000 chars (got %). Likely a placeholder. (lesson_id=%, agent=%)',
      length(NEW.content_json::text), NEW.lesson_id, NEW.created_by_agent;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire BEFORE INSERT and UPDATE so it blocks the write
CREATE TRIGGER trg_guard_placeholder_approval
  BEFORE INSERT OR UPDATE ON public.content_versions
  FOR EACH ROW
  EXECUTE FUNCTION guard_content_version_placeholder_approval();
