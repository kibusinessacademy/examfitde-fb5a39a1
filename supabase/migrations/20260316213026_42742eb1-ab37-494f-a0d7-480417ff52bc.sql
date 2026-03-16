
-- Atomic JSONB merge for package_content_shards (avoids read-modify-write race)
CREATE OR REPLACE FUNCTION public.merge_package_content_shard_meta(
  p_package_id uuid,
  p_learning_field_id uuid,
  p_fanout_id uuid,
  p_chunk_index integer,
  p_patch jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_content_shards
  SET
    meta = coalesce(meta, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
    updated_at = now()
  WHERE package_id = p_package_id
    AND learning_field_id = p_learning_field_id
    AND fanout_id = p_fanout_id
    AND chunk_index = p_chunk_index;
$$;
