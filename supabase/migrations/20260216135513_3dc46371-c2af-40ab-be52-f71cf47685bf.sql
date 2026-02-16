
-- Fix the guard trigger to allow service_role writes (pipeline/factory mode)
CREATE OR REPLACE FUNCTION public.guard_lesson_content_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.published_versions IS DISTINCT FROM NEW.published_versions THEN
    RETURN NEW;
  END IF;
  IF OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;
  -- Allow council publish bypass
  IF current_setting('council.publish_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;
  -- Allow service_role (pipeline edge functions)
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'COUNCIL_BYPASS_BLOCKED: Direct writes to lessons.content are forbidden. Use council pipeline → content_versions → publish_approved_version()';
END;
$$;
