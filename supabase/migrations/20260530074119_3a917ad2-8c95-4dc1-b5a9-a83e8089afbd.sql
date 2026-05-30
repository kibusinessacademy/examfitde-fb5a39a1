
-- Welle 2A — Cross-Agent Visibility
ALTER TABLE public.berufs_ki_agent_memory
  ADD COLUMN IF NOT EXISTS source_agent text,
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3) NOT NULL DEFAULT 0.5;

ALTER TABLE public.berufs_ki_agent_memory
  DROP CONSTRAINT IF EXISTS berufs_ki_agent_memory_visibility_scope_check;
ALTER TABLE public.berufs_ki_agent_memory
  ADD CONSTRAINT berufs_ki_agent_memory_visibility_scope_check
  CHECK (visibility_scope IN ('agent','team','org'));

ALTER TABLE public.berufs_ki_agent_memory
  DROP CONSTRAINT IF EXISTS berufs_ki_agent_memory_confidence_check;
ALTER TABLE public.berufs_ki_agent_memory
  ADD CONSTRAINT berufs_ki_agent_memory_confidence_check
  CHECK (confidence >= 0 AND confidence <= 1);

CREATE INDEX IF NOT EXISTS idx_bki_agent_memory_visibility
  ON public.berufs_ki_agent_memory (visibility_scope, memory_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bki_agent_memory_source_agent
  ON public.berufs_ki_agent_memory (source_agent) WHERE source_agent IS NOT NULL;

-- Welle 2B — Unified Memory View (virtuelle SSOT über 4 Memory-Stores)
CREATE OR REPLACE VIEW public.v_organizational_memory_unified AS
SELECT
  'berufs_ki_agent_memory'::text AS source_table,
  m.id,
  m.memory_type AS kind,
  m.key AS title,
  (m.value::text) AS summary,
  m.confidence,
  COALESCE(m.source_agent, a.slug) AS source_agent,
  m.visibility_scope,
  (m.visibility_scope IN ('team','org')) AS cross_agent_visible,
  NULL::text AS status,
  NULL::uuid AS superseded_by,
  m.created_at,
  m.created_at AS updated_at
FROM public.berufs_ki_agent_memory m
LEFT JOIN public.berufs_ki_agents a ON a.id = m.agent_id
UNION ALL
SELECT
  'gil_research_memory',
  g.id, 'research'::text, g.topic, g.finding, g.confidence,
  g.contributed_by, g.scope, (g.scope IN ('global','org','team')),
  CASE WHEN g.superseded_by IS NOT NULL THEN 'superseded' ELSE 'active' END,
  g.superseded_by, g.created_at, g.created_at
FROM public.gil_research_memory g
UNION ALL
SELECT
  'project_intelligence_memory',
  p.id, p.kind::text, p.title, p.summary, p.confidence,
  COALESCE(p.recorded_by::text, 'system'),
  COALESCE(p.vertical_key, 'org'), true,
  p.status::text, p.superseded_by, p.created_at, p.updated_at
FROM public.project_intelligence_memory p
UNION ALL
SELECT
  'marketing_learnings',
  l.id, 'marketing_'||l.impact_area, left(l.learning, 80), l.learning,
  0.6::numeric, l.source_type, 'org'::text, true,
  'active'::text, NULL::uuid, l.created_at, l.created_at
FROM public.marketing_learnings l;

REVOKE ALL ON public.v_organizational_memory_unified FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_organizational_memory_unified TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_organizational_memory_unified(
  _limit int DEFAULT 200,
  _scope text DEFAULT NULL,
  _min_confidence numeric DEFAULT 0
)
RETURNS SETOF public.v_organizational_memory_unified
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM public.v_organizational_memory_unified u
    WHERE (_scope IS NULL OR u.visibility_scope = _scope)
      AND u.confidence >= COALESCE(_min_confidence, 0)
    ORDER BY u.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 1000));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_organizational_memory_unified(int, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_organizational_memory_unified(int, text, numeric) TO authenticated;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('agent_memory_cross_agent_write',
  ARRAY['agent_id','memory_type','visibility_scope','confidence'],
  'welle2_memory_visibility')
ON CONFLICT (action_type) DO NOTHING;
