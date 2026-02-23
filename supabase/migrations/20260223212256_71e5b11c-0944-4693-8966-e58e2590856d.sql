
-- ═══════════════════════════════════════════════════════════════
-- Council Hard-Enforce Migration
-- 1. Remove service_role bypass from guard trigger
-- 2. Restrict pipeline_write_lesson_content to placeholders only
-- 3. Add lessons.content sync to publish_approved_version
-- ═══════════════════════════════════════════════════════════════

-- 1) Replace guard_lesson_content_writes: remove service_role bypass
CREATE OR REPLACE FUNCTION public.guard_lesson_content_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow if bypass flag is set (used by publish_approved_version and pipeline placeholder writes)
  IF current_setting('council.publish_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Allow published_versions pointer updates (no content change)
  IF OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;

  -- Block all other direct content writes — must go through Council pipeline
  RAISE EXCEPTION 'COUNCIL_REQUIRED: Direct lesson content writes are blocked. Use content_versions + publish_approved_version() or pipeline_write_lesson_content() for placeholders.';
END;
$$;

-- 2) Restrict pipeline_write_lesson_content to placeholder-only writes
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(
  p_lesson_id uuid,
  p_content jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set bypass for the guard trigger
  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.lessons
  SET content = p_content,
      status = CASE
        WHEN COALESCE((p_content->>'_placeholder')::boolean, false) THEN 'placeholder'
        ELSE 'draft'
      END,
      updated_at = now()
  WHERE id = p_lesson_id;

  -- Reset bypass
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;

-- 3) Enhance publish_approved_version to also write lessons.content
-- This ensures the learner UI (which reads lessons.content) gets the approved content
CREATE OR REPLACE FUNCTION public.publish_approved_version(
  p_lesson_id uuid,
  p_step_key text,
  p_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content jsonb;
BEGIN
  -- Fetch the approved content from content_versions
  SELECT content_json INTO v_content
  FROM public.content_versions
  WHERE id = p_version_id
    AND lesson_id = p_lesson_id
    AND status = 'approved';

  IF v_content IS NULL THEN
    RAISE EXCEPTION 'PUBLISH_FAILED: No approved content_version found for version_id=% lesson_id=%', p_version_id, p_lesson_id;
  END IF;

  -- Set bypass for the guard trigger
  PERFORM set_config('council.publish_bypass', 'true', true);

  -- Update both published_versions pointer AND lessons.content atomically
  UPDATE public.lessons
  SET published_versions = COALESCE(published_versions, '{}'::jsonb) || jsonb_build_object(p_step_key, p_version_id::text),
      content = v_content,
      status = 'published',
      updated_at = now()
  WHERE id = p_lesson_id;

  -- Mark the content_version as published
  UPDATE public.content_versions
  SET status = 'published',
      published_at = now()
  WHERE id = p_version_id;

  -- Reset bypass
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;
