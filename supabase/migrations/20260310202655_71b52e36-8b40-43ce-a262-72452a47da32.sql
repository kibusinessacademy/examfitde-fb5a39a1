-- Safe JSONB merge RPC: patches meta without overwriting existing keys
CREATE OR REPLACE FUNCTION public.merge_job_meta(
  p_job_id uuid,
  p_patch jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_queue
  SET
    meta = COALESCE(meta, '{}'::jsonb) || p_patch,
    updated_at = now()
  WHERE id = p_job_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_job_meta(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_job_meta(uuid, jsonb) TO service_role;