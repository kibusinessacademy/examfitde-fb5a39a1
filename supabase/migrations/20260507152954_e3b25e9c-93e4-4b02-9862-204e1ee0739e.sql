CREATE OR REPLACE FUNCTION public.admin_get_growth_graph_audit_log(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action_type text,
  result_status text,
  result_detail jsonb,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.created_at,
    a.action_type,
    a.result_status,
    a.result_detail,
    a.metadata
  FROM public.auto_heal_log a
  WHERE a.action_type IN (
    'growth_content_graph_backfill',
    'growth_content_graph_apply_edges',
    'growth_content_graph_apply_edges_dry_run',
    'growth_content_node_register',
    'growth_content_edge_link'
  )
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_graph_audit_log(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_graph_audit_log(int) TO authenticated, service_role;