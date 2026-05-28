
CREATE TABLE IF NOT EXISTS public.verwaltung_agent_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_key text NOT NULL,
  workflow_key text NOT NULL,
  workflow_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('process','document','communication','governance','executive','fachverfahren')),
  summary text NOT NULL,
  process_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  kpi_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  doc_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  automation_hints jsonb NOT NULL DEFAULT '[]'::jsonb,
  governance_notes text,
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_key, workflow_key)
);

GRANT SELECT ON public.verwaltung_agent_workflows TO anon, authenticated;
GRANT ALL ON public.verwaltung_agent_workflows TO service_role;

ALTER TABLE public.verwaltung_agent_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_workflows public read active"
  ON public.verwaltung_agent_workflows FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "agent_workflows service write"
  ON public.verwaltung_agent_workflows FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_agent_workflows_dept ON public.verwaltung_agent_workflows(department_key) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_agent_workflows_category ON public.verwaltung_agent_workflows(category) WHERE is_active;

CREATE OR REPLACE FUNCTION public.list_verwaltung_agents()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'department_key', d.department_key,
    'department_name', d.department_name,
    'category', d.category,
    'workflow_count', COALESCE(w.cnt, 0),
    'roles_count', COALESCE(jsonb_array_length(d.roles), 0),
    'processes_count', COALESCE(jsonb_array_length(d.processes), 0)
  ) ORDER BY d.department_name), '[]'::jsonb)
  FROM verwaltung_department_dna d
  LEFT JOIN (
    SELECT department_key, COUNT(*)::int AS cnt
    FROM verwaltung_agent_workflows
    WHERE is_active
    GROUP BY department_key
  ) w ON w.department_key = d.department_key;
$$;

CREATE OR REPLACE FUNCTION public.list_verwaltung_workflows(_department_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.category, w.workflow_name), '[]'::jsonb)
  FROM verwaltung_agent_workflows w
  WHERE w.department_key = _department_key AND w.is_active;
$$;

CREATE OR REPLACE FUNCTION public.get_verwaltung_agent(_department_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'dna', to_jsonb(d),
    'workflows', COALESCE((
      SELECT jsonb_agg(to_jsonb(w) ORDER BY w.category, w.workflow_name)
      FROM verwaltung_agent_workflows w
      WHERE w.department_key = d.department_key AND w.is_active
    ), '[]'::jsonb)
  )
  FROM verwaltung_department_dna d
  WHERE d.department_key = _department_key;
$$;

REVOKE ALL ON FUNCTION public.list_verwaltung_agents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_verwaltung_agents() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_verwaltung_workflows(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_verwaltung_workflows(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_verwaltung_agent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_verwaltung_agent(text) TO anon, authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'verwaltung_agent_workflow_run',
  ARRAY['department_key','workflow_key','user_id_hash','model','latency_ms','sources_count'],
  'verwaltungsagentos'
)
ON CONFLICT (action_type) DO NOTHING;
