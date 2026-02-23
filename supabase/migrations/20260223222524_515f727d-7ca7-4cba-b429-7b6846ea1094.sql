
-- Harden publish_admin_version: require service_role caller
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
  v_role text;
BEGIN
  -- Guard: only service_role callers (Edge Functions) may use this path
  v_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ADMIN_PUBLISH_BLOCKED: Only service_role callers may use publish_admin_version (got role: %)', v_role;
  END IF;

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
