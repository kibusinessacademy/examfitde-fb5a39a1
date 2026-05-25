-- Phase 6: Berufs-KI Agent Operating System

CREATE TYPE public.berufs_ki_agent_category AS ENUM (
  'communication', 'operations', 'analysis', 'compliance',
  'support', 'workflow', 'career', 'recruiting',
  'education', 'industry'
);

CREATE TYPE public.berufs_ki_agent_run_status AS ENUM (
  'queued', 'running', 'awaiting_approval', 'approved', 'rejected', 'completed', 'failed', 'escalated'
);

-- ===== Agent Registry =====
CREATE TABLE public.berufs_ki_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category public.berufs_ki_agent_category NOT NULL,
  role text NOT NULL,
  profession_scope uuid[] NOT NULL DEFAULT '{}',
  competency_scope uuid[] NOT NULL DEFAULT '{}',
  allowed_tools text[] NOT NULL DEFAULT '{}',
  allowed_workflows uuid[] NOT NULL DEFAULT '{}',
  governance_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_threshold numeric(4,3) NOT NULL DEFAULT 0.700 CHECK (confidence_threshold BETWEEN 0 AND 1),
  requires_human_approval boolean NOT NULL DEFAULT true,
  blocked_actions text[] NOT NULL DEFAULT '{}',
  runtime_profile jsonb NOT NULL DEFAULT '{"model":"google/gemini-3-flash-preview"}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bki_agents_category ON public.berufs_ki_agents(category);
CREATE INDEX idx_bki_agents_active ON public.berufs_ki_agents(is_active);

ALTER TABLE public.berufs_ki_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_admin_all" ON public.berufs_ki_agents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "agents_authenticated_read_active" ON public.berufs_ki_agents
  FOR SELECT TO authenticated USING (is_active = true);

-- ===== Agent Runs =====
CREATE TABLE public.berufs_ki_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.berufs_ki_agents(id) ON DELETE CASCADE,
  orchestration_id uuid,
  user_id uuid,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  confidence_score numeric(4,3),
  status public.berufs_ki_agent_run_status NOT NULL DEFAULT 'queued',
  governance_violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_reason text,
  approval_required boolean NOT NULL DEFAULT false,
  approved_by uuid,
  approved_at timestamptz,
  audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bki_agent_runs_agent ON public.berufs_ki_agent_runs(agent_id);
CREATE INDEX idx_bki_agent_runs_status ON public.berufs_ki_agent_runs(status);
CREATE INDEX idx_bki_agent_runs_created ON public.berufs_ki_agent_runs(created_at DESC);

ALTER TABLE public.berufs_ki_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_runs_admin_all" ON public.berufs_ki_agent_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "agent_runs_owner_read" ON public.berufs_ki_agent_runs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ===== Multi-Agent Orchestrations =====
CREATE TABLE public.berufs_ki_agent_orchestrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  trigger_event text,
  step_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.berufs_ki_agent_orchestrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orchestrations_admin_all" ON public.berufs_ki_agent_orchestrations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "orchestrations_authenticated_read_active" ON public.berufs_ki_agent_orchestrations
  FOR SELECT TO authenticated USING (is_active = true);

-- ===== Agent Memory =====
CREATE TABLE public.berufs_ki_agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.berufs_ki_agents(id) ON DELETE CASCADE,
  memory_type text NOT NULL DEFAULT 'pattern',
  key text NOT NULL,
  value jsonb NOT NULL,
  importance numeric(4,3) NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, memory_type, key)
);

CREATE INDEX idx_bki_agent_memory_agent ON public.berufs_ki_agent_memory(agent_id);

ALTER TABLE public.berufs_ki_agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memory_admin_all" ON public.berufs_ki_agent_memory
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- updated_at triggers
CREATE TRIGGER trg_bki_agents_updated BEFORE UPDATE ON public.berufs_ki_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bki_agent_runs_updated BEFORE UPDATE ON public.berufs_ki_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bki_orch_updated BEFORE UPDATE ON public.berufs_ki_agent_orchestrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Sync agents into knowledge graph =====
CREATE OR REPLACE FUNCTION public.bki_sync_agent_node()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.berufs_ki_graph_nodes (node_type, title, description, source_system, source_ref_id, metadata)
  VALUES ('ai_agent', NEW.name, NEW.description, 'agent_definition', NEW.id,
          jsonb_build_object('slug', NEW.slug, 'category', NEW.category, 'role', NEW.role))
  ON CONFLICT (node_type, source_system, source_ref_id) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description, metadata = EXCLUDED.metadata, updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bki_sync_agent_node
  AFTER INSERT OR UPDATE ON public.berufs_ki_agents
  FOR EACH ROW EXECUTE FUNCTION public.bki_sync_agent_node();

-- ===== Seed minimal agent set =====
INSERT INTO public.berufs_ki_agents (slug, name, description, category, role, requires_human_approval, confidence_threshold) VALUES
  ('communication-agent', 'Kommunikations-Agent', 'Erstellt Kundenantworten, E-Mails, Eskalations-Texte und Protokolle.', 'communication', 'communication', true, 0.75),
  ('workflow-agent', 'Workflow-Agent', 'Orchestriert Prozesse, erzeugt Tickets und Follow-Ups, wendet SOPs an.', 'workflow', 'orchestrator', true, 0.80),
  ('analysis-agent', 'Analyse-Agent', 'Analysiert KPIs, erkennt Risiken und erstellt Reports.', 'analysis', 'analyst', false, 0.70),
  ('compliance-agent', 'Compliance-Agent', 'Prüft DSGVO, Governance und markiert Risiken.', 'compliance', 'auditor', true, 0.85),
  ('career-agent', 'Karriere-Agent', 'Erkennt Skill-Gaps und empfiehlt Karrierepfade & Weiterbildungen.', 'career', 'advisor', false, 0.70),
  ('recruiting-agent', 'Recruiting-Agent', 'Analysiert Kandidaten, führt Kompetenzmatching durch und generiert Interviewfragen.', 'recruiting', 'recruiter', true, 0.75)
ON CONFLICT (slug) DO NOTHING;

-- ===== Admin RPCs =====
CREATE OR REPLACE FUNCTION public.admin_bki_list_agents()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.category, a.name), '[]'::jsonb)
  INTO v_rows FROM public.berufs_ki_agents a;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_upsert_agent(
  _slug text,
  _name text,
  _description text,
  _category public.berufs_ki_agent_category,
  _role text,
  _requires_human_approval boolean DEFAULT true,
  _confidence_threshold numeric DEFAULT 0.7,
  _is_active boolean DEFAULT true,
  _governance_rules jsonb DEFAULT '{}'::jsonb,
  _allowed_tools text[] DEFAULT '{}'::text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  INSERT INTO public.berufs_ki_agents
    (slug, name, description, category, role, requires_human_approval, confidence_threshold, is_active, governance_rules, allowed_tools)
  VALUES (_slug, _name, _description, _category, _role, _requires_human_approval, _confidence_threshold, _is_active, _governance_rules, _allowed_tools)
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    role = EXCLUDED.role,
    requires_human_approval = EXCLUDED.requires_human_approval,
    confidence_threshold = EXCLUDED.confidence_threshold,
    is_active = EXCLUDED.is_active,
    governance_rules = EXCLUDED.governance_rules,
    allowed_tools = EXCLUDED.allowed_tools,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_list_agent_runs(_status text DEFAULT NULL, _limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT r.*, a.name AS agent_name, a.category AS agent_category
    FROM public.berufs_ki_agent_runs r
    JOIN public.berufs_ki_agents a ON a.id = r.agent_id
    WHERE _status IS NULL OR r.status::text = _status
    ORDER BY r.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500))
  ) r;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_decide_agent_run(
  _run_id uuid,
  _decision text,
  _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status public.berufs_ki_agent_run_status;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF _decision NOT IN ('approve','reject','escalate') THEN
    RAISE EXCEPTION 'invalid decision: %', _decision;
  END IF;
  v_status := CASE _decision
    WHEN 'approve' THEN 'approved'::public.berufs_ki_agent_run_status
    WHEN 'reject'  THEN 'rejected'::public.berufs_ki_agent_run_status
    ELSE 'escalated'::public.berufs_ki_agent_run_status
  END;
  UPDATE public.berufs_ki_agent_runs
  SET status = v_status,
      approved_by = auth.uid(),
      approved_at = now(),
      audit_trail = audit_trail || jsonb_build_array(jsonb_build_object(
        'event', _decision, 'by', auth.uid(), 'at', now(), 'notes', _notes
      ))
  WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run not found';
  END IF;
  RETURN jsonb_build_object('id', _run_id, 'status', v_status);
END;
$$;

-- ===== Phase 6E: Performance + 6F: Control Center =====
CREATE OR REPLACE FUNCTION public.admin_bki_agent_performance(_window interval DEFAULT interval '7 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.run_count DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT a.id AS agent_id, a.name, a.category::text,
      count(r.id) AS run_count,
      count(*) FILTER (WHERE r.status = 'completed') AS completed_count,
      count(*) FILTER (WHERE r.status = 'rejected') AS rejected_count,
      count(*) FILTER (WHERE r.status = 'escalated') AS escalated_count,
      count(*) FILTER (WHERE r.status = 'awaiting_approval') AS awaiting_count,
      ROUND(AVG(r.confidence_score)::numeric, 3) AS avg_confidence,
      ROUND(AVG(r.duration_ms)::numeric, 0) AS avg_duration_ms,
      jsonb_array_length(COALESCE((SELECT jsonb_agg(v) FROM (SELECT jsonb_array_elements(r.governance_violations) v WHERE jsonb_typeof(r.governance_violations) = 'array') s), '[]'::jsonb)) AS dummy
    FROM public.berufs_ki_agents a
    LEFT JOIN public.berufs_ki_agent_runs r
      ON r.agent_id = a.id AND r.created_at >= now() - _window
    GROUP BY a.id, a.name, a.category
  ) p;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_control_center()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT jsonb_build_object(
    'agents', jsonb_build_object(
      'total', (SELECT count(*) FROM public.berufs_ki_agents),
      'active', (SELECT count(*) FROM public.berufs_ki_agents WHERE is_active),
      'by_category', (SELECT COALESCE(jsonb_object_agg(category, cnt), '{}'::jsonb)
                      FROM (SELECT category::text, count(*) AS cnt FROM public.berufs_ki_agents GROUP BY category) t)
    ),
    'runs_24h', jsonb_build_object(
      'total', (SELECT count(*) FROM public.berufs_ki_agent_runs WHERE created_at >= now() - interval '24 hours'),
      'awaiting_approval', (SELECT count(*) FROM public.berufs_ki_agent_runs WHERE status = 'awaiting_approval'),
      'escalated', (SELECT count(*) FROM public.berufs_ki_agent_runs WHERE status = 'escalated' AND created_at >= now() - interval '24 hours'),
      'failed', (SELECT count(*) FROM public.berufs_ki_agent_runs WHERE status = 'failed' AND created_at >= now() - interval '24 hours')
    ),
    'governance', jsonb_build_object(
      'agents_requiring_approval', (SELECT count(*) FROM public.berufs_ki_agents WHERE requires_human_approval AND is_active),
      'pending_evolution', (SELECT count(*) FROM public.berufs_ki_evolution_candidates WHERE status = 'detected')
    ),
    'graph', jsonb_build_object(
      'nodes', (SELECT count(*) FROM public.berufs_ki_graph_nodes),
      'edges', (SELECT count(*) FROM public.berufs_ki_graph_edges)
    ),
    'orchestrations', (SELECT count(*) FROM public.berufs_ki_agent_orchestrations WHERE is_active)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bki_list_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_upsert_agent(text, text, text, public.berufs_ki_agent_category, text, boolean, numeric, boolean, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_list_agent_runs(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_decide_agent_run(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_agent_performance(interval) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_control_center() TO authenticated;