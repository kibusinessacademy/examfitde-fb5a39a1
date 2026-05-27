-- Enums
CREATE TYPE public.intelligence_memory_kind AS ENUM (
  'successful_pattern','quality_issue','risk_incident','conversion_learning',
  'ux_learning','seo_learning','workflow_failure','security_pattern','architecture_decision'
);

CREATE TYPE public.intelligence_memory_status AS ENUM ('active','retired','superseded');

-- Table
CREATE TABLE public.project_intelligence_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_key TEXT NOT NULL UNIQUE,
  kind public.intelligence_memory_kind NOT NULL,
  vertical_key TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  status public.intelligence_memory_status NOT NULL DEFAULT 'active',
  source_run_id UUID REFERENCES public.agent_outcome_bundles(id) ON DELETE SET NULL,
  business_intent_id UUID REFERENCES public.business_intents(id) ON DELETE SET NULL,
  bundle_id UUID REFERENCES public.agent_outcome_bundles(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  recorded_by UUID,
  retired_at TIMESTAMPTZ,
  retired_reason TEXT,
  superseded_by UUID REFERENCES public.project_intelligence_memory(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(title) >= 4),
  CHECK (length(summary) >= 8)
);

GRANT SELECT ON public.project_intelligence_memory TO authenticated;
GRANT ALL ON public.project_intelligence_memory TO service_role;

ALTER TABLE public.project_intelligence_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read intelligence memory"
ON public.project_intelligence_memory FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_pim_kind ON public.project_intelligence_memory(kind);
CREATE INDEX idx_pim_vertical ON public.project_intelligence_memory(vertical_key);
CREATE INDEX idx_pim_status ON public.project_intelligence_memory(status);
CREATE INDEX idx_pim_intent ON public.project_intelligence_memory(business_intent_id);
CREATE INDEX idx_pim_bundle ON public.project_intelligence_memory(bundle_id);
CREATE INDEX idx_pim_tags ON public.project_intelligence_memory USING GIN(tags);

CREATE TRIGGER trg_pim_updated_at
BEFORE UPDATE ON public.project_intelligence_memory
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit contracts (schema: action_type, required_keys, schema_version, owner_module)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('intelligence_memory_recorded', ARRAY['memory_id','memory_key','kind','actor_id'], 'berufs-ki'),
  ('intelligence_memory_retired', ARRAY['memory_id','memory_key','actor_id','reason'], 'berufs-ki'),
  ('intelligence_memory_classified', ARRAY['memory_id','memory_key','actor_id','new_status'], 'berufs-ki')
ON CONFLICT (action_type) DO NOTHING;

-- RPC: record
CREATE OR REPLACE FUNCTION public.admin_record_intelligence_memory(
  _memory_key TEXT,
  _kind public.intelligence_memory_kind,
  _title TEXT,
  _summary TEXT,
  _vertical_key TEXT DEFAULT NULL,
  _payload JSONB DEFAULT '{}'::jsonb,
  _confidence NUMERIC DEFAULT 0.5,
  _source_run_id UUID DEFAULT NULL,
  _business_intent_id UUID DEFAULT NULL,
  _bundle_id UUID DEFAULT NULL,
  _tags TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_id UUID;
  v_existing UUID;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF length(coalesce(_title,'')) < 4 THEN RAISE EXCEPTION 'title too short'; END IF;
  IF length(coalesce(_summary,'')) < 8 THEN RAISE EXCEPTION 'summary too short'; END IF;

  SELECT id INTO v_existing FROM public.project_intelligence_memory WHERE memory_key = _memory_key;

  INSERT INTO public.project_intelligence_memory(
    memory_key, kind, vertical_key, title, summary, payload, confidence,
    source_run_id, business_intent_id, bundle_id, tags, recorded_by
  ) VALUES (
    _memory_key, _kind, _vertical_key, _title, _summary, coalesce(_payload,'{}'::jsonb),
    coalesce(_confidence, 0.5), _source_run_id, _business_intent_id, _bundle_id,
    coalesce(_tags, ARRAY[]::TEXT[]), v_actor
  )
  ON CONFLICT (memory_key) DO UPDATE SET
    kind = EXCLUDED.kind,
    vertical_key = EXCLUDED.vertical_key,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    payload = EXCLUDED.payload,
    confidence = EXCLUDED.confidence,
    source_run_id = COALESCE(EXCLUDED.source_run_id, public.project_intelligence_memory.source_run_id),
    business_intent_id = COALESCE(EXCLUDED.business_intent_id, public.project_intelligence_memory.business_intent_id),
    bundle_id = COALESCE(EXCLUDED.bundle_id, public.project_intelligence_memory.bundle_id),
    tags = EXCLUDED.tags,
    updated_at = now()
  RETURNING id INTO v_id;

  PERFORM public.fn_emit_audit(
    'intelligence_memory_recorded',
    jsonb_build_object(
      'memory_id', v_id, 'memory_key', _memory_key,
      'kind', _kind::text, 'actor_id', v_actor,
      'was_update', v_existing IS NOT NULL
    )
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_intelligence_memory(TEXT, public.intelligence_memory_kind, TEXT, TEXT, TEXT, JSONB, NUMERIC, UUID, UUID, UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_intelligence_memory(TEXT, public.intelligence_memory_kind, TEXT, TEXT, TEXT, JSONB, NUMERIC, UUID, UUID, UUID, TEXT[]) TO authenticated, service_role;

-- RPC: list
CREATE OR REPLACE FUNCTION public.admin_list_intelligence_memory(
  _kind public.intelligence_memory_kind DEFAULT NULL,
  _vertical_key TEXT DEFAULT NULL,
  _status public.intelligence_memory_status DEFAULT NULL,
  _business_intent_id UUID DEFAULT NULL,
  _limit INT DEFAULT 200
)
RETURNS TABLE(
  id UUID, memory_key TEXT, kind public.intelligence_memory_kind, vertical_key TEXT,
  title TEXT, summary TEXT, payload JSONB, confidence NUMERIC,
  status public.intelligence_memory_status, source_run_id UUID, business_intent_id UUID,
  bundle_id UUID, tags TEXT[], recorded_by UUID, retired_at TIMESTAMPTZ, retired_reason TEXT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, intent_title TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT m.id, m.memory_key, m.kind, m.vertical_key, m.title, m.summary, m.payload,
         m.confidence, m.status, m.source_run_id, m.business_intent_id, m.bundle_id,
         m.tags, m.recorded_by, m.retired_at, m.retired_reason, m.created_at, m.updated_at,
         bi.title AS intent_title
  FROM public.project_intelligence_memory m
  LEFT JOIN public.business_intents bi ON bi.id = m.business_intent_id
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (_kind IS NULL OR m.kind = _kind)
    AND (_vertical_key IS NULL OR m.vertical_key = _vertical_key)
    AND (_status IS NULL OR m.status = _status)
    AND (_business_intent_id IS NULL OR m.business_intent_id = _business_intent_id)
  ORDER BY m.updated_at DESC
  LIMIT COALESCE(_limit, 200);
$$;

REVOKE ALL ON FUNCTION public.admin_list_intelligence_memory(public.intelligence_memory_kind, TEXT, public.intelligence_memory_status, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_intelligence_memory(public.intelligence_memory_kind, TEXT, public.intelligence_memory_status, UUID, INT) TO authenticated, service_role;

-- RPC: retire
CREATE OR REPLACE FUNCTION public.admin_retire_intelligence_memory(_memory_id UUID, _reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_key TEXT;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF length(coalesce(_reason,'')) < 5 THEN
    RAISE EXCEPTION 'reason too short (min 5 chars)';
  END IF;

  UPDATE public.project_intelligence_memory
     SET status = 'retired', retired_at = now(), retired_reason = _reason, updated_at = now()
   WHERE id = _memory_id
   RETURNING memory_key INTO v_key;

  IF v_key IS NULL THEN RAISE EXCEPTION 'memory not found'; END IF;

  PERFORM public.fn_emit_audit(
    'intelligence_memory_retired',
    jsonb_build_object('memory_id', _memory_id, 'memory_key', v_key, 'actor_id', v_actor, 'reason', _reason)
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retire_intelligence_memory(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retire_intelligence_memory(UUID, TEXT) TO authenticated, service_role;

-- RPC: classify
CREATE OR REPLACE FUNCTION public.admin_classify_intelligence_memory(
  _memory_id UUID,
  _new_status public.intelligence_memory_status,
  _superseded_by UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_key TEXT;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  UPDATE public.project_intelligence_memory
     SET status = _new_status,
         superseded_by = CASE WHEN _new_status = 'superseded' THEN _superseded_by ELSE superseded_by END,
         updated_at = now()
   WHERE id = _memory_id
   RETURNING memory_key INTO v_key;

  IF v_key IS NULL THEN RAISE EXCEPTION 'memory not found'; END IF;

  PERFORM public.fn_emit_audit(
    'intelligence_memory_classified',
    jsonb_build_object('memory_id', _memory_id, 'memory_key', v_key, 'actor_id', v_actor, 'new_status', _new_status::text, 'superseded_by', _superseded_by)
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_classify_intelligence_memory(UUID, public.intelligence_memory_status, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_classify_intelligence_memory(UUID, public.intelligence_memory_status, UUID) TO authenticated, service_role;