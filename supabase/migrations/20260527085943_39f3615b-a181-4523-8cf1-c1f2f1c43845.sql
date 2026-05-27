-- BerufAgentOS v2 Cut 2.3 — Continuous Outcome Intelligence (READ-ONLY)

-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.outcome_intelligence_kind AS ENUM (
    'workflow_intelligence','outcome_drift','ux_friction',
    'governance_risk','seo_intelligence','support_signal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outcome_intelligence_severity AS ENUM ('info','low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outcome_intelligence_status AS ENUM ('open','acknowledged','muted','resolved_observed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TABLE
CREATE TABLE IF NOT EXISTS public.outcome_intelligence_findings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key            text NOT NULL UNIQUE,
  kind                   public.outcome_intelligence_kind NOT NULL,
  vertical_key           text NOT NULL,
  business_intent_id     uuid REFERENCES public.business_intents(id) ON DELETE SET NULL,
  bundle_id              uuid REFERENCES public.agent_outcome_bundles(id) ON DELETE SET NULL,
  title                  text NOT NULL,
  interpretation         text NOT NULL,
  affected_scope         jsonb NOT NULL DEFAULT '{}'::jsonb,
  signals                jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_inspection text,
  confidence_score       numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  severity_score         numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (severity_score BETWEEN 0 AND 1),
  business_impact_score  numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (business_impact_score BETWEEN 0 AND 1),
  severity               public.outcome_intelligence_severity NOT NULL DEFAULT 'medium',
  status                 public.outcome_intelligence_status NOT NULL DEFAULT 'open',
  status_note            text,
  status_changed_by      uuid,
  status_changed_at      timestamptz,
  detected_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  observation_window     interval,
  source                 text NOT NULL DEFAULT 'manual',
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oif_kind ON public.outcome_intelligence_findings(kind);
CREATE INDEX IF NOT EXISTS idx_oif_status_open ON public.outcome_intelligence_findings(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_oif_vertical ON public.outcome_intelligence_findings(vertical_key);
CREATE INDEX IF NOT EXISTS idx_oif_intent ON public.outcome_intelligence_findings(business_intent_id);
CREATE INDEX IF NOT EXISTS idx_oif_detected_at ON public.outcome_intelligence_findings(detected_at DESC);

-- Priority helper
CREATE OR REPLACE FUNCTION public.fn_outcome_intelligence_priority(
  _severity_score numeric, _business_impact_score numeric, _confidence_score numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND((
    COALESCE(_severity_score,0)*0.4
  + COALESCE(_business_impact_score,0)*0.4
  + COALESCE(_confidence_score,0)*0.2)::numeric, 4);
$$;

GRANT SELECT, INSERT, UPDATE ON public.outcome_intelligence_findings TO authenticated;
GRANT ALL ON public.outcome_intelligence_findings TO service_role;

ALTER TABLE public.outcome_intelligence_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read intelligence findings"
  ON public.outcome_intelligence_findings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write intelligence findings"
  ON public.outcome_intelligence_findings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update intelligence findings"
  ON public.outcome_intelligence_findings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_oif_updated_at
  BEFORE UPDATE ON public.outcome_intelligence_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- AUDIT CONTRACTS
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('outcome_intelligence_recorded',
    ARRAY['finding_key','kind','severity','confidence_score','business_impact_score'],
    'berufs-ki.outcome-intelligence'),
  ('outcome_intelligence_status_changed',
    ARRAY['finding_key','from_status','to_status','reason'],
    'berufs-ki.outcome-intelligence'),
  ('outcome_intelligence_rescored',
    ARRAY['finding_key','severity','confidence_score','business_impact_score'],
    'berufs-ki.outcome-intelligence')
ON CONFLICT (action_type) DO NOTHING;

-- RPCs
CREATE OR REPLACE FUNCTION public.admin_record_outcome_intelligence(
  _finding_key text,
  _kind public.outcome_intelligence_kind,
  _vertical_key text,
  _title text,
  _interpretation text,
  _affected_scope jsonb DEFAULT '{}'::jsonb,
  _signals jsonb DEFAULT '[]'::jsonb,
  _recommended_inspection text DEFAULT NULL,
  _severity public.outcome_intelligence_severity DEFAULT 'medium',
  _confidence_score numeric DEFAULT 0.5,
  _severity_score numeric DEFAULT 0.5,
  _business_impact_score numeric DEFAULT 0.5,
  _business_intent_id uuid DEFAULT NULL,
  _bundle_id uuid DEFAULT NULL,
  _observation_window interval DEFAULT NULL,
  _source text DEFAULT 'manual'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_existing uuid;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF length(coalesce(_interpretation,'')) < 12 THEN
    RAISE EXCEPTION 'interpretation must be >= 12 chars';
  END IF;

  SELECT id INTO v_existing FROM outcome_intelligence_findings WHERE finding_key = _finding_key;
  IF v_existing IS NULL THEN
    INSERT INTO outcome_intelligence_findings(
      finding_key, kind, vertical_key, business_intent_id, bundle_id,
      title, interpretation, affected_scope, signals, recommended_inspection,
      severity, confidence_score, severity_score, business_impact_score,
      observation_window, source, created_by
    ) VALUES (
      _finding_key, _kind, _vertical_key, _business_intent_id, _bundle_id,
      _title, _interpretation, _affected_scope, _signals, _recommended_inspection,
      _severity, _confidence_score, _severity_score, _business_impact_score,
      _observation_window, _source, auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE outcome_intelligence_findings SET
      kind = _kind, vertical_key = _vertical_key,
      business_intent_id = _business_intent_id, bundle_id = _bundle_id,
      title = _title, interpretation = _interpretation,
      affected_scope = _affected_scope, signals = _signals,
      recommended_inspection = _recommended_inspection,
      severity = _severity,
      confidence_score = _confidence_score,
      severity_score = _severity_score,
      business_impact_score = _business_impact_score,
      observation_window = COALESCE(_observation_window, observation_window),
      last_seen_at = now(),
      source = _source
    WHERE id = v_existing
    RETURNING id INTO v_id;
  END IF;

  PERFORM fn_emit_audit(
    'outcome_intelligence_recorded',
    jsonb_build_object(
      'finding_key', _finding_key,
      'kind', _kind::text,
      'severity', _severity::text,
      'confidence_score', _confidence_score,
      'business_impact_score', _business_impact_score),
    'outcome_intelligence_finding', v_id::text, 'success');

  RETURN jsonb_build_object('finding_id', v_id, 'finding_key', _finding_key);
END $$;

CREATE OR REPLACE FUNCTION public.admin_classify_outcome_intelligence(
  _finding_id uuid,
  _new_status public.outcome_intelligence_status,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row outcome_intelligence_findings%ROWTYPE;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF length(coalesce(_reason,'')) < 5 THEN
    RAISE EXCEPTION 'reason must be >= 5 chars';
  END IF;

  SELECT * INTO v_row FROM outcome_intelligence_findings WHERE id = _finding_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'finding not found'; END IF;

  UPDATE outcome_intelligence_findings
     SET status = _new_status, status_note = _reason,
         status_changed_by = auth.uid(), status_changed_at = now()
   WHERE id = _finding_id;

  PERFORM fn_emit_audit(
    'outcome_intelligence_status_changed',
    jsonb_build_object(
      'finding_key', v_row.finding_key,
      'from_status', v_row.status::text,
      'to_status', _new_status::text,
      'reason', _reason),
    'outcome_intelligence_finding', _finding_id::text, 'success');

  RETURN jsonb_build_object('finding_id', _finding_id, 'status', _new_status);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_outcome_intelligence(
  _kind public.outcome_intelligence_kind DEFAULT NULL,
  _vertical_key text DEFAULT NULL,
  _status public.outcome_intelligence_status DEFAULT NULL,
  _limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.priority_score DESC, t.detected_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT f.id, f.finding_key, f.kind, f.vertical_key,
           f.business_intent_id, f.bundle_id,
           f.title, f.interpretation, f.affected_scope, f.signals,
           f.recommended_inspection,
           f.severity, f.confidence_score, f.severity_score, f.business_impact_score,
           fn_outcome_intelligence_priority(f.severity_score, f.business_impact_score, f.confidence_score) AS priority_score,
           f.status, f.status_note, f.status_changed_at,
           f.detected_at, f.last_seen_at, f.source,
           bi.title AS business_intent_title
      FROM outcome_intelligence_findings f
      LEFT JOIN business_intents bi ON bi.id = f.business_intent_id
     WHERE (_kind IS NULL OR f.kind = _kind)
       AND (_vertical_key IS NULL OR f.vertical_key = _vertical_key)
       AND (_status IS NULL OR f.status = _status)
     ORDER BY priority_score DESC, f.detected_at DESC
     LIMIT GREATEST(_limit, 1)
  ) t;
  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_outcome_intelligence_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  WITH base AS (SELECT * FROM outcome_intelligence_findings WHERE status = 'open')
  SELECT jsonb_build_object(
    'total_open', (SELECT COUNT(*) FROM base),
    'critical_open', (SELECT COUNT(*) FROM base WHERE severity = 'critical'),
    'high_open', (SELECT COUNT(*) FROM base WHERE severity = 'high'),
    'avg_priority', (
      SELECT ROUND(AVG(fn_outcome_intelligence_priority(severity_score, business_impact_score, confidence_score))::numeric, 4)
      FROM base),
    'by_kind', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT kind::text, COUNT(*) AS c FROM base GROUP BY kind) k),
    'by_vertical', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('vertical_key', vertical_key, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT vertical_key, COUNT(*) AS c FROM base GROUP BY vertical_key) v),
    'recent_24h', (SELECT COUNT(*) FROM outcome_intelligence_findings WHERE detected_at >= now() - interval '24 hours'),
    'recent_7d',  (SELECT COUNT(*) FROM outcome_intelligence_findings WHERE detected_at >= now() - interval '7 days')
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_record_outcome_intelligence FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_classify_outcome_intelligence FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_outcome_intelligence FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_outcome_intelligence_summary FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_outcome_intelligence TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_classify_outcome_intelligence TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_outcome_intelligence TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_outcome_intelligence_summary TO authenticated;