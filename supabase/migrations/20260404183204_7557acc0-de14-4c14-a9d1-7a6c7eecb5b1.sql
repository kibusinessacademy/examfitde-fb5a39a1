
-- Atomic JSONB merge for package_steps.meta
-- Prevents read-modify-write race conditions
CREATE OR REPLACE FUNCTION public.merge_package_step_meta(
  p_package_id uuid,
  p_step_key text,
  p_patch jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE package_steps
  SET meta = COALESCE(meta, '{}'::jsonb) || p_patch,
      updated_at = now()
  WHERE package_id = p_package_id
    AND step_key = p_step_key;
$$;

-- Also create a version that removes specific keys (for clearBlockState)
CREATE OR REPLACE FUNCTION public.remove_package_step_meta_keys(
  p_package_id uuid,
  p_step_key text,
  p_keys text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE package_steps
  SET meta = COALESCE(meta, '{}'::jsonb) - p_keys,
      updated_at = now()
  WHERE package_id = p_package_id
    AND step_key = p_step_key;
$$;
