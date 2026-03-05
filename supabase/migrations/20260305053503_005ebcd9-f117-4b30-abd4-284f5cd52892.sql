
-- RPC 3: resolve_next_step (fixed — no sort_order column, use created_at)
CREATE OR REPLACE FUNCTION public.resolve_next_step(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(ps.*)
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued'
  ORDER BY ps.created_at ASC
  LIMIT 1;
$$;
