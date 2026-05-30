ALTER TABLE public.berufs_ki_agent_runs
  ADD COLUMN IF NOT EXISTS tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error_category text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_retryable boolean;

COMMENT ON COLUMN public.berufs_ki_agent_runs.tool_calls IS
  'Array of ToolResult envelopes written by safeTool(): {tool, ok, error_code?, error_category?, duration_ms, input_hash, context_chars, retryable?}.';
COMMENT ON COLUMN public.berufs_ki_agent_runs.error_category IS
  'Top-level error taxonomy: tool_error|context_overflow|silent_empty|governance_block|llm_error|unknown.';

CREATE INDEX IF NOT EXISTS idx_bki_agent_runs_error_cat
  ON public.berufs_ki_agent_runs (error_category, created_at DESC)
  WHERE error_category IS NOT NULL;

CREATE OR REPLACE VIEW public.v_agent_failure_clusters AS
SELECT
  COALESCE(r.error_category, 'unclassified') AS error_category,
  COALESCE(r.error_code, 'UNKNOWN') AS error_code,
  a.slug AS agent_slug,
  a.category AS agent_category,
  COUNT(*) FILTER (WHERE r.created_at > now() - interval '24 hours')::int AS count_24h,
  COUNT(*) FILTER (WHERE r.created_at > now() - interval '7 days')::int AS count_7d,
  MAX(r.created_at) AS last_seen_at,
  (ARRAY_AGG(r.error_message ORDER BY r.created_at DESC) FILTER (WHERE r.error_message IS NOT NULL))[1] AS sample_error
FROM public.berufs_ki_agent_runs r
JOIN public.berufs_ki_agents a ON a.id = r.agent_id
WHERE r.status IN ('failed','escalated','rejected')
  AND r.created_at > now() - interval '7 days'
GROUP BY 1,2,3,4;

REVOKE ALL ON public.v_agent_failure_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_agent_failure_clusters TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_agent_failure_clusters(_min_count_24h int DEFAULT 1)
RETURNS SETOF public.v_agent_failure_clusters
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.v_agent_failure_clusters
  WHERE count_24h >= COALESCE(_min_count_24h, 1)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY count_24h DESC, last_seen_at DESC
  LIMIT 200
$$;

REVOKE ALL ON FUNCTION public.admin_get_agent_failure_clusters(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_agent_failure_clusters(int) TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('agent_tool_call_completed',
   ARRAY['agent_run_id','tool','ok','duration_ms'],
   'agent-reliability'),
  ('agent_run_classified',
   ARRAY['agent_run_id','error_category'],
   'agent-reliability')
ON CONFLICT (action_type) DO NOTHING;