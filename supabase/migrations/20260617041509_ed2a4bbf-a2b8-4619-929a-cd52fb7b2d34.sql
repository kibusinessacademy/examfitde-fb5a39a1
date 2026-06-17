
-- ============================================================
-- BUNDLE C.1 — QUALIFICATION LAYER
-- ============================================================

-- Severity enum
DO $$ BEGIN
  CREATE TYPE public.qualification_severity AS ENUM ('critical','high','medium','low','ignore');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Qualification rules: map finding patterns → severity weights
CREATE TABLE IF NOT EXISTS public.qualification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  description text,
  source_kind text NOT NULL,                         -- e.g. 'package_step','seo_finding','security_finding','quality_audit'
  match_expression jsonb NOT NULL DEFAULT '{}'::jsonb, -- structured matcher
  base_severity public.qualification_severity NOT NULL DEFAULT 'medium',
  impact_weight numeric NOT NULL DEFAULT 1.0,
  urgency_weight numeric NOT NULL DEFAULT 1.0,
  recoverability_weight numeric NOT NULL DEFAULT 1.0,
  confidence_floor numeric NOT NULL DEFAULT 0.5,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.qualification_rules TO authenticated;
GRANT ALL ON public.qualification_rules TO service_role;
ALTER TABLE public.qualification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qualification_rules_admin_read" ON public.qualification_rules
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "qualification_rules_service_all" ON public.qualification_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Qualification scores: per finding/event, computed verdict
CREATE TABLE IF NOT EXISTS public.qualification_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  source_id text NOT NULL,
  package_id uuid NULL,
  rule_key text NULL,
  severity public.qualification_severity NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  impact numeric NOT NULL DEFAULT 0.5 CHECK (impact BETWEEN 0 AND 1),
  urgency numeric NOT NULL DEFAULT 0.5 CHECK (urgency BETWEEN 0 AND 1),
  recoverability numeric NOT NULL DEFAULT 0.5 CHECK (recoverability BETWEEN 0 AND 1),
  composite_score numeric NOT NULL DEFAULT 0,
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_qualification_scores_severity ON public.qualification_scores (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qualification_scores_package ON public.qualification_scores (package_id) WHERE package_id IS NOT NULL;
GRANT SELECT ON public.qualification_scores TO authenticated;
GRANT ALL ON public.qualification_scores TO service_role;
ALTER TABLE public.qualification_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qualification_scores_admin_read" ON public.qualification_scores
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "qualification_scores_service_all" ON public.qualification_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Scorer RPC: deterministic composite from rule weights
CREATE OR REPLACE FUNCTION public.fn_qualification_score(
  _source_kind text,
  _source_id text,
  _package_id uuid,
  _signal jsonb
) RETURNS public.qualification_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.qualification_rules%ROWTYPE;
  v_sev public.qualification_severity;
  v_conf numeric := COALESCE((_signal->>'confidence')::numeric, 0.7);
  v_imp  numeric := COALESCE((_signal->>'impact')::numeric, 0.5);
  v_urg  numeric := COALESCE((_signal->>'urgency')::numeric, 0.5);
  v_rec  numeric := COALESCE((_signal->>'recoverability')::numeric, 0.5);
  v_score numeric;
  v_row public.qualification_scores%ROWTYPE;
BEGIN
  SELECT * INTO v_rule FROM public.qualification_rules
   WHERE source_kind = _source_kind AND is_active
     AND (match_expression = '{}'::jsonb OR _signal @> match_expression)
   ORDER BY (match_expression <> '{}'::jsonb) DESC, updated_at DESC
   LIMIT 1;

  IF v_rule.id IS NOT NULL THEN
    v_sev := v_rule.base_severity;
    v_imp := LEAST(1, v_imp * v_rule.impact_weight);
    v_urg := LEAST(1, v_urg * v_rule.urgency_weight);
    v_rec := LEAST(1, v_rec * v_rule.recoverability_weight);
    v_conf := GREATEST(v_conf, v_rule.confidence_floor);
  ELSE
    v_sev := 'medium';
  END IF;

  v_score := ROUND((v_imp*0.4 + v_urg*0.35 + (1 - v_rec)*0.25) * v_conf, 4);

  INSERT INTO public.qualification_scores (
    source_kind, source_id, package_id, rule_key, severity,
    confidence, impact, urgency, recoverability, composite_score, rationale
  ) VALUES (
    _source_kind, _source_id, _package_id, v_rule.rule_key, v_sev,
    v_conf, v_imp, v_urg, v_rec, v_score,
    jsonb_build_object('rule_id', v_rule.id, 'signal', _signal)
  )
  ON CONFLICT (source_kind, source_id) DO UPDATE
    SET severity = EXCLUDED.severity,
        confidence = EXCLUDED.confidence,
        impact = EXCLUDED.impact,
        urgency = EXCLUDED.urgency,
        recoverability = EXCLUDED.recoverability,
        composite_score = EXCLUDED.composite_score,
        rationale = EXCLUDED.rationale,
        rule_key = EXCLUDED.rule_key,
        package_id = EXCLUDED.package_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- Seed core rules
INSERT INTO public.qualification_rules (rule_key, description, source_kind, match_expression, base_severity, impact_weight, urgency_weight)
VALUES
  ('publish_blocker', 'Publish guard P0001 / blocked auto_publish', 'package_step', '{"step":"package_auto_publish","status":"failed"}'::jsonb, 'critical', 1.0, 1.0),
  ('handbook_depth_fail', 'validate_handbook_depth softFail tail', 'package_step', '{"step":"validate_handbook_depth"}'::jsonb, 'high', 0.9, 0.7),
  ('council_verdict_revise', 'Council REVISE verdict', 'council_verdict', '{"verdict":"REVISE"}'::jsonb, 'high', 0.8, 0.6),
  ('seo_missing_og', 'Missing OG image / social card', 'seo_finding', '{"code":"missing_og_image"}'::jsonb, 'medium', 0.5, 0.4),
  ('seo_minor_drift', 'Minor SEO drift', 'seo_finding', '{"severity":"minor"}'::jsonb, 'low', 0.3, 0.3),
  ('security_critical', 'Critical security finding', 'security_finding', '{"severity":"critical"}'::jsonb, 'critical', 1.0, 1.0),
  ('quality_bronze', 'Bronze quality (75-84)', 'quality_audit', '{"tier":"bronze"}'::jsonb, 'medium', 0.6, 0.5)
ON CONFLICT (rule_key) DO NOTHING;

-- ============================================================
-- BUNDLE C.2 — COUNCIL DAG (Decision Chains)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.council_dag_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_council text NOT NULL,
  to_council text NOT NULL,
  edge_type text NOT NULL DEFAULT 'depends_on', -- depends_on | escalates_to | informs
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_council, to_council, edge_type)
);
GRANT SELECT ON public.council_dag_edges TO authenticated;
GRANT ALL ON public.council_dag_edges TO service_role;
ALTER TABLE public.council_dag_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "council_dag_edges_admin_read" ON public.council_dag_edges
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "council_dag_edges_service_all" ON public.council_dag_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Decision chains: links findings to causal sequences
CREATE TABLE IF NOT EXISTS public.council_decision_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_finding_kind text NOT NULL,
  root_finding_id text NOT NULL,
  package_id uuid NULL,
  chain jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{council, verdict, finding_id, at}]
  status text NOT NULL DEFAULT 'open', -- open | resolved | escalated | abandoned
  qualification_severity public.qualification_severity NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_council_decision_chains_status ON public.council_decision_chains (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_council_decision_chains_package ON public.council_decision_chains (package_id) WHERE package_id IS NOT NULL;
GRANT SELECT ON public.council_decision_chains TO authenticated;
GRANT ALL ON public.council_decision_chains TO service_role;
ALTER TABLE public.council_decision_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "council_decision_chains_admin_read" ON public.council_decision_chains
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "council_decision_chains_service_all" ON public.council_decision_chains
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Append step to a chain
CREATE OR REPLACE FUNCTION public.fn_council_chain_append(
  _chain_id uuid,
  _council text,
  _verdict text,
  _finding_id text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS public.council_decision_chains
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.council_decision_chains%ROWTYPE;
BEGIN
  UPDATE public.council_decision_chains
     SET chain = chain || jsonb_build_array(jsonb_build_object(
            'council', _council,
            'verdict', _verdict,
            'finding_id', _finding_id,
            'at', now(),
            'metadata', _metadata
         )),
         metadata = metadata || jsonb_build_object('last_council', _council)
   WHERE id = _chain_id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- Seed canonical DAG edges
INSERT INTO public.council_dag_edges (from_council, to_council, edge_type, condition) VALUES
  ('content', 'quality', 'depends_on', '{}'::jsonb),
  ('quality', 'compliance', 'depends_on', '{}'::jsonb),
  ('compliance', 'publish', 'depends_on', '{}'::jsonb),
  ('seo', 'growth', 'informs', '{}'::jsonb),
  ('growth', 'publish', 'informs', '{}'::jsonb),
  ('quality', 'publish', 'escalates_to', '{"verdict":"REVISE"}'::jsonb)
ON CONFLICT DO NOTHING;

-- ============================================================
-- BUNDLE C.3 — QUARANTINE LAYER
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.quarantine_status AS ENUM ('quarantined','under_review','released','permanently_blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Package-level quarantine (extends thin existing package_quarantine concept without colliding)
CREATE TABLE IF NOT EXISTS public.package_quarantine_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  attempts_before integer NOT NULL DEFAULT 0,
  qualification_severity public.qualification_severity NULL,
  council_verdict text NULL,
  decision_chain_id uuid NULL REFERENCES public.council_decision_chains(id) ON DELETE SET NULL,
  status public.quarantine_status NOT NULL DEFAULT 'quarantined',
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz NULL,
  released_by uuid NULL,
  release_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_package_quarantine_ledger_status ON public.package_quarantine_ledger (status, quarantined_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_quarantine_ledger_package ON public.package_quarantine_ledger (package_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_quarantine_active
  ON public.package_quarantine_ledger (package_id)
  WHERE status IN ('quarantined','under_review');

GRANT SELECT ON public.package_quarantine_ledger TO authenticated;
GRANT ALL ON public.package_quarantine_ledger TO service_role;
ALTER TABLE public.package_quarantine_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pq_ledger_admin_read" ON public.package_quarantine_ledger
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "pq_ledger_admin_write" ON public.package_quarantine_ledger
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "pq_ledger_service_all" ON public.package_quarantine_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Quarantine RPC
CREATE OR REPLACE FUNCTION public.fn_package_quarantine(
  _package_id uuid,
  _reason_code text,
  _reason_detail text DEFAULT NULL,
  _severity public.qualification_severity DEFAULT 'high',
  _attempts integer DEFAULT 0,
  _council_verdict text DEFAULT NULL,
  _decision_chain_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS public.package_quarantine_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.package_quarantine_ledger%ROWTYPE;
BEGIN
  INSERT INTO public.package_quarantine_ledger (
    package_id, reason_code, reason_detail, attempts_before, qualification_severity,
    council_verdict, decision_chain_id, metadata
  ) VALUES (
    _package_id, _reason_code, _reason_detail, _attempts, _severity,
    _council_verdict, _decision_chain_id, _metadata
  )
  ON CONFLICT (package_id) WHERE status IN ('quarantined','under_review')
  DO UPDATE SET
    reason_code = EXCLUDED.reason_code,
    reason_detail = EXCLUDED.reason_detail,
    attempts_before = public.package_quarantine_ledger.attempts_before + EXCLUDED.attempts_before,
    metadata = public.package_quarantine_ledger.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING * INTO v_row;

  -- Audit
  INSERT INTO public.auto_heal_log (action_type, package_id, payload, status)
  VALUES ('package_quarantined', _package_id,
          jsonb_build_object('reason', _reason_code, 'severity', _severity, 'detail', _reason_detail),
          'success')
  ON CONFLICT DO NOTHING;

  RETURN v_row;
END $$;

-- Release RPC
CREATE OR REPLACE FUNCTION public.fn_package_quarantine_release(
  _package_id uuid,
  _release_reason text,
  _released_by uuid DEFAULT auth.uid()
) RETURNS public.package_quarantine_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.package_quarantine_ledger%ROWTYPE;
BEGIN
  IF NOT public.has_role(COALESCE(_released_by, auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'Only admins can release packages from quarantine';
  END IF;

  UPDATE public.package_quarantine_ledger
     SET status = 'released',
         released_at = now(),
         released_by = _released_by,
         release_reason = _release_reason,
         updated_at = now()
   WHERE package_id = _package_id
     AND status IN ('quarantined','under_review')
  RETURNING * INTO v_row;

  INSERT INTO public.auto_heal_log (action_type, package_id, payload, status)
  VALUES ('package_quarantine_released', _package_id,
          jsonb_build_object('reason', _release_reason, 'released_by', _released_by),
          'success')
  ON CONFLICT DO NOTHING;

  RETURN v_row;
END $$;

-- Admin-readable status view
CREATE OR REPLACE VIEW public.v_admin_qualification_status AS
SELECT
  qs.severity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE qs.created_at > now() - interval '24 hours') AS last_24h,
  AVG(qs.composite_score) AS avg_score
FROM public.qualification_scores qs
GROUP BY qs.severity;

CREATE OR REPLACE VIEW public.v_admin_quarantine_status AS
SELECT
  pql.status,
  pql.reason_code,
  COUNT(*) AS total,
  MAX(pql.quarantined_at) AS most_recent
FROM public.package_quarantine_ledger pql
GROUP BY pql.status, pql.reason_code
ORDER BY total DESC;
