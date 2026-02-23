-- 1) Add missing published_at + published_by columns
ALTER TABLE public.content_versions
  ADD COLUMN IF NOT EXISTS published_at timestamptz NULL;
ALTER TABLE public.content_versions
  ADD COLUMN IF NOT EXISTS published_by text NULL;

-- 2) Re-create publish_approved_version WITH council verdict check (hard enforce)
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
  v_verdict text;
BEGIN
  -- Verify council verdict exists and is approved
  SELECT final_decision INTO v_verdict
  FROM public.council_verdicts
  WHERE content_version_id = p_version_id;

  IF v_verdict IS NULL OR v_verdict IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: Council verdict required (got: %). Use publish_admin_version() for admin-trusted publishes.', COALESCE(v_verdict, 'NONE');
  END IF;

  -- Fetch approved content
  SELECT content_json INTO v_content
  FROM public.content_versions
  WHERE id = p_version_id
    AND lesson_id = p_lesson_id
    AND status = 'approved';

  IF v_content IS NULL THEN
    RAISE EXCEPTION 'PUBLISH_FAILED: No approved content_version found for version_id=% lesson_id=%', p_version_id, p_lesson_id;
  END IF;

  -- Set bypass for guard trigger
  PERFORM set_config('council.publish_bypass', 'true', true);

  -- Atomic update: published_versions pointer + lessons.content
  UPDATE public.lessons
  SET published_versions = COALESCE(published_versions, '{}'::jsonb) || jsonb_build_object(p_step_key, p_version_id::text),
      content = v_content,
      status = 'published',
      updated_at = now()
  WHERE id = p_lesson_id;

  -- Mark version as published
  UPDATE public.content_versions
  SET status = 'published',
      published_at = now(),
      published_by = 'council'
  WHERE id = p_version_id;

  -- Reset bypass
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;

-- 3) Create publish_admin_version: role-gated, no verdict required
-- For admin tools like course-upgrade-ihk that insert trusted content
CREATE OR REPLACE FUNCTION public.publish_admin_version(
  p_lesson_id uuid,
  p_step_key text,
  p_version_id uuid,
  p_admin_agent text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content jsonb;
  v_agent text;
BEGIN
  -- Verify the version exists, belongs to this lesson, and was created by an admin tool
  SELECT content_json, created_by_agent INTO v_content, v_agent
  FROM public.content_versions
  WHERE id = p_version_id
    AND lesson_id = p_lesson_id
    AND status = 'approved';

  IF v_content IS NULL THEN
    RAISE EXCEPTION 'ADMIN_PUBLISH_FAILED: No approved content_version found for version_id=% lesson_id=%', p_version_id, p_lesson_id;
  END IF;

  -- Guard: only admin_tool:* agents may use this path
  IF v_agent IS NULL OR NOT v_agent LIKE 'admin_tool:%' THEN
    RAISE EXCEPTION 'ADMIN_PUBLISH_BLOCKED: Only admin_tool:* agents may use publish_admin_version (got: %). Use council pipeline for regular content.', COALESCE(v_agent, 'NULL');
  END IF;

  -- Set bypass for guard trigger
  PERFORM set_config('council.publish_bypass', 'true', true);

  -- Atomic update
  UPDATE public.lessons
  SET published_versions = COALESCE(published_versions, '{}'::jsonb) || jsonb_build_object(p_step_key, p_version_id::text),
      content = v_content,
      status = 'published',
      updated_at = now()
  WHERE id = p_lesson_id;

  -- Mark version as published
  UPDATE public.content_versions
  SET status = 'published',
      published_at = now(),
      published_by = p_admin_agent
  WHERE id = p_version_id;

  -- Reset bypass
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;
