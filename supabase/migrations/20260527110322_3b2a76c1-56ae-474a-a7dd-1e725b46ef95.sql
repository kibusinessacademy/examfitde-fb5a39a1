-- ============================================================================
-- BerufAgentOS v2 Cut 2.4 — Controlled Recommendations Layer (HITL)
-- Scope: Detection → Proposal → Review Queue. KEIN Auto-Apply. KEINE Mutationen.
-- ============================================================================

-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.outcome_fix_proposal_type AS ENUM (
    'kpi_drift_fix','workflow_stall_fix','ux_friction_fix',
    'governance_remediation','revenue_leak_fix','seo_recovery',
    'support_signal_response','generic_recommendation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outcome_fix_proposal_source AS ENUM (
    'workflow_intelligence','ux_intelligence','governance_intelligence',
    'seo_intelligence','revenue_intelligence','support_intelligence',
    'manual_curation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outcome_fix_review_state AS ENUM (
    'draft','in_review','approved','rejected','changes_requested','withdrawn','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outcome_fix_review_decision AS ENUM (
    'approved','rejected','changes_requested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- TABLE: outcome_fix_proposals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.outcome_fix_proposals (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key              text NOT NULL UNIQUE,
  proposal_type             public.outcome_fix_proposal_type NOT NULL,
  proposal_source           public.outcome_fix_proposal_source NOT NULL,
  vertical_key              text NOT NULL,
  finding_id                uuid REFERENCES public.outcome_intelligence_findings(id) ON DELETE SET NULL,
  business_intent_id        uuid REFERENCES public.business_intents(id) ON DELETE SET NULL,
  bundle_id                 uuid REFERENCES public.agent_outcome_bundles(id) ON DELETE SET NULL,

  title                     text NOT NULL,
  proposal_summary          text NOT NULL,
  suggested_fix             text NOT NULL,
  expected_outcome          text NOT NULL,
  risk_summary              text NOT NULL,
  rollback_plan             text NOT NULL,
  test_strategy             text NOT NULL,

  proposal_evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_scope            jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_kpi_delta_pct_min numeric(6,2),
  expected_kpi_delta_pct_max numeric(6,2),

  severity                  public.outcome_intelligence_severity NOT NULL DEFAULT 'medium',
  confidence_score          numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  business_impact_score     numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (business_impact_score BETWEEN 0 AND 1),
  risk_score                numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (risk_score BETWEEN 0 AND 1),

  review_state              public.outcome_fix_review_state NOT NULL DEFAULT 'draft',
  review_state_note         text,
  review_state_changed_by   uuid,
  review_state_changed_at   timestamptz,
  expires_at                timestamptz,

  source                    text NOT NULL DEFAULT 'auto_detector',
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ofp_summary_min CHECK (length(proposal_summary) >= 24),
  CONSTRAINT ofp_fix_min     CHECK (length(suggested_fix) >= 24),
  CONSTRAINT ofp_rollback_min CHECK (length(rollback_plan) >= 12),
  CONSTRAINT ofp_test_min     CHECK (length(test_strategy) >= 12),
  CONSTRAINT ofp_kpi_range_valid CHECK (
    expected_kpi_delta_pct_min IS NULL
    OR expected_kpi_delta_pct_max IS NULL
    OR expected_kpi_delta_pct_min <= expected_kpi_delta_pct_max
  )
);

CREATE INDEX IF NOT EXISTS idx_ofp_state ON public.outcome_fix_proposals(review_state);
CREATE INDEX IF NOT EXISTS idx_ofp_state_open ON public.outcome_fix_proposals(review_state)
  WHERE review_state IN ('draft','in_review','changes_requested');
CREATE INDEX IF NOT EXISTS idx_ofp_type ON public.outcome_fix_proposals(proposal_type);
CREATE INDEX IF NOT EXISTS idx_ofp_source ON public.outcome_fix_proposals(proposal_source);
CREATE INDEX IF NOT EXISTS idx_ofp_vertical ON public.outcome_fix_proposals(vertical_key);
CREATE INDEX IF NOT EXISTS idx_ofp_finding ON public.outcome_fix_proposals(finding_id);
CREATE INDEX IF NOT EXISTS idx_ofp_intent ON public.outcome_fix_proposals(business_intent_id);
CREATE INDEX IF NOT EXISTS idx_ofp_created_at ON public.outcome_fix_proposals(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.outcome_fix_proposals TO authenticated;
GRANT ALL ON public.outcome_fix_proposals TO service_role;

ALTER TABLE public.outcome_fix_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read fix proposals"
  ON public.outcome_fix_proposals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert fix proposals"
  ON public.outcome_fix_proposals FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update fix proposals"
  ON public.outcome_fix_proposals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ofp_updated_at
  BEFORE UPDATE ON public.outcome_fix_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- TABLE: outcome_fix_reviews
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.outcome_fix_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid NOT NULL REFERENCES public.outcome_fix_proposals(id) ON DELETE CASCADE,
  reviewer_id         uuid,
  decision            public.outcome_fix_review_decision NOT NULL,
  reason              text NOT NULL,
  recommended_followup text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofr_reason_min CHECK (length(reason) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_ofr_proposal ON public.outcome_fix_reviews(proposal_id);
CREATE INDEX IF NOT EXISTS idx_ofr_created_at ON public.outcome_fix_reviews(created_at DESC);

GRANT SELECT, INSERT ON public.outcome_fix_reviews TO authenticated;
GRANT ALL ON public.outcome_fix_reviews TO service_role;

ALTER TABLE public.outcome_fix_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read fix reviews"
  ON public.outcome_fix_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert fix reviews"
  ON public.outcome_fix_reviews FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- HELPER: priority formula
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_outcome_fix_priority(
  _severity_score numeric,
  _business_impact_score numeric,
  _confidence_score numeric,
  _risk_score numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND((
    COALESCE(_severity_score, 0) * 0.30
  + COALESCE(_business_impact_score, 0) * 0.35
  + COALESCE(_confidence_score, 0) * 0.20
  + (1 - COALESCE(_risk_score, 1)) * 0.15)::numeric, 4);
$$;

-- ============================================================================
-- AUDIT CONTRACTS
-- ============================================================================
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('outcome_fix_proposal_recorded',
    ARRAY['proposal_key','proposal_type','proposal_source','severity','confidence_score','business_impact_score','risk_score'],
    'berufs-ki.outcome-fix'),
  ('outcome_fix_proposal_review_decided',
    ARRAY['proposal_key','decision','from_state','to_state','reason'],
    'berufs-ki.outcome-fix'),
  ('outcome_fix_proposal_withdrawn',
    ARRAY['proposal_key','from_state','reason'],
    'berufs-ki.outcome-fix')
ON CONFLICT (action_type) DO NOTHING;

-- ============================================================================
-- RPC: admin_propose_outcome_fix (upsert by proposal_key)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_propose_outcome_fix(
  _proposal_key text,
  _proposal_type public.outcome_fix_proposal_type,
  _proposal_source public.outcome_fix_proposal_source,
  _vertical_key text,
  _title text,
  _proposal_summary text,
  _suggested_fix text,
  _expected_outcome text,
  _risk_summary text,
  _rollback_plan text,
  _test_strategy text,
  _proposal_evidence jsonb DEFAULT '{}'::jsonb,
  _affected_scope jsonb DEFAULT '{}'::jsonb,
  _finding_id uuid DEFAULT NULL,
  _business_intent_id uuid DEFAULT NULL,
  _bundle_id uuid DEFAULT NULL,
  _severity public.outcome_intelligence_severity DEFAULT 'medium',
  _confidence_score numeric DEFAULT 0.5,
  _business_impact_score numeric DEFAULT 0.5,
  _risk_score numeric DEFAULT 0.5,
  _expected_kpi_delta_pct_min numeric DEFAULT NULL,
  _expected_kpi_delta_pct_max numeric DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL,
  _source text DEFAULT 'auto_detector'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_existing uuid;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT id INTO v_existing FROM outcome_fix_proposals WHERE proposal_key = _proposal_key;

  IF v_existing IS NULL THEN
    INSERT INTO outcome_fix_proposals(
      proposal_key, proposal_type, proposal_source, vertical_key,
      finding_id, business_intent_id, bundle_id,
      title, proposal_summary, suggested_fix, expected_outcome,
      risk_summary, rollback_plan, test_strategy,
      proposal_evidence, affected_scope,
      severity, confidence_score, business_impact_score, risk_score,
      expected_kpi_delta_pct_min, expected_kpi_delta_pct_max,
      expires_at, source, created_by, review_state
    ) VALUES (
      _proposal_key, _proposal_type, _proposal_source, _vertical_key,
      _finding_id, _business_intent_id, _bundle_id,
      _title, _proposal_summary, _suggested_fix, _expected_outcome,
      _risk_summary, _rollback_plan, _test_strategy,
      _proposal_evidence, _affected_scope,
      _severity, _confidence_score, _business_impact_score, _risk_score,
      _expected_kpi_delta_pct_min, _expected_kpi_delta_pct_max,
      _expires_at, _source, auth.uid(), 'in_review'
    ) RETURNING id INTO v_id;
  ELSE
    -- Only allow re-record while still in open states (draft / in_review / changes_requested)
    UPDATE outcome_fix_proposals SET
      proposal_type = _proposal_type,
      proposal_source = _proposal_source,
      vertical_key = _vertical_key,
      finding_id = _finding_id,
      business_intent_id = _business_intent_id,
      bundle_id = _bundle_id,
      title = _title,
      proposal_summary = _proposal_summary,
      suggested_fix = _suggested_fix,
      expected_outcome = _expected_outcome,
      risk_summary = _risk_summary,
      rollback_plan = _rollback_plan,
      test_strategy = _test_strategy,
      proposal_evidence = _proposal_evidence,
      affected_scope = _affected_scope,
      severity = _severity,
      confidence_score = _confidence_score,
      business_impact_score = _business_impact_score,
      risk_score = _risk_score,
      expected_kpi_delta_pct_min = _expected_kpi_delta_pct_min,
      expected_kpi_delta_pct_max = _expected_kpi_delta_pct_max,
      expires_at = COALESCE(_expires_at, expires_at),
      source = _source
    WHERE id = v_existing
      AND review_state IN ('draft','in_review','changes_requested')
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'proposal % is locked (already approved/rejected/withdrawn/expired)', _proposal_key;
    END IF;
  END IF;

  PERFORM fn_emit_audit(
    'outcome_fix_proposal_recorded',
    jsonb_build_object(
      'proposal_key', _proposal_key,
      'proposal_type', _proposal_type::text,
      'proposal_source', _proposal_source::text,
      'severity', _severity::text,
      'confidence_score', _confidence_score,
      'business_impact_score', _business_impact_score,
      'risk_score', _risk_score),
    'outcome_fix_proposal', v_id::text, 'success');

  RETURN jsonb_build_object('proposal_id', v_id, 'proposal_key', _proposal_key);
END $$;

-- ============================================================================
-- RPC: admin_submit_fix_review — HITL gate (NIE Auto-Apply)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_submit_fix_review(
  _proposal_id uuid,
  _decision public.outcome_fix_review_decision,
  _reason text,
  _recommended_followup text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row outcome_fix_proposals%ROWTYPE;
  v_new_state public.outcome_fix_review_state;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF length(coalesce(_reason, '')) < 10 THEN
    RAISE EXCEPTION 'reason must be >= 10 chars';
  END IF;

  SELECT * INTO v_row FROM outcome_fix_proposals WHERE id = _proposal_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'proposal not found'; END IF;

  IF v_row.review_state NOT IN ('draft','in_review','changes_requested') THEN
    RAISE EXCEPTION 'proposal % is locked in state %', v_row.proposal_key, v_row.review_state;
  END IF;

  v_new_state := CASE _decision
    WHEN 'approved' THEN 'approved'::public.outcome_fix_review_state
    WHEN 'rejected' THEN 'rejected'::public.outcome_fix_review_state
    WHEN 'changes_requested' THEN 'changes_requested'::public.outcome_fix_review_state
  END;

  INSERT INTO outcome_fix_reviews(proposal_id, reviewer_id, decision, reason, recommended_followup)
  VALUES (_proposal_id, auth.uid(), _decision, _reason, _recommended_followup);

  UPDATE outcome_fix_proposals
     SET review_state = v_new_state,
         review_state_note = _reason,
         review_state_changed_by = auth.uid(),
         review_state_changed_at = now()
   WHERE id = _proposal_id;

  PERFORM fn_emit_audit(
    'outcome_fix_proposal_review_decided',
    jsonb_build_object(
      'proposal_key', v_row.proposal_key,
      'decision', _decision::text,
      'from_state', v_row.review_state::text,
      'to_state', v_new_state::text,
      'reason', _reason),
    'outcome_fix_proposal', _proposal_id::text, 'success');

  RETURN jsonb_build_object('proposal_id', _proposal_id, 'review_state', v_new_state);
END $$;

-- ============================================================================
-- RPC: admin_withdraw_fix_proposal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_withdraw_fix_proposal(
  _proposal_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row outcome_fix_proposals%ROWTYPE;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF length(coalesce(_reason, '')) < 10 THEN
    RAISE EXCEPTION 'reason must be >= 10 chars';
  END IF;

  SELECT * INTO v_row FROM outcome_fix_proposals WHERE id = _proposal_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'proposal not found'; END IF;
  IF v_row.review_state IN ('approved','rejected','withdrawn','expired') THEN
    RAISE EXCEPTION 'cannot withdraw proposal in state %', v_row.review_state;
  END IF;

  UPDATE outcome_fix_proposals
     SET review_state = 'withdrawn',
         review_state_note = _reason,
         review_state_changed_by = auth.uid(),
         review_state_changed_at = now()
   WHERE id = _proposal_id;

  PERFORM fn_emit_audit(
    'outcome_fix_proposal_withdrawn',
    jsonb_build_object(
      'proposal_key', v_row.proposal_key,
      'from_state', v_row.review_state::text,
      'reason', _reason),
    'outcome_fix_proposal', _proposal_id::text, 'success');

  RETURN jsonb_build_object('proposal_id', _proposal_id, 'review_state', 'withdrawn');
END $$;

-- ============================================================================
-- RPC: admin_list_fix_proposals
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_fix_proposals(
  _state public.outcome_fix_review_state DEFAULT NULL,
  _proposal_type public.outcome_fix_proposal_type DEFAULT NULL,
  _proposal_source public.outcome_fix_proposal_source DEFAULT NULL,
  _vertical_key text DEFAULT NULL,
  _business_intent_id uuid DEFAULT NULL,
  _limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.priority_score DESC, t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT p.id, p.proposal_key, p.proposal_type, p.proposal_source, p.vertical_key,
           p.finding_id, p.business_intent_id, p.bundle_id,
           p.title, p.proposal_summary, p.suggested_fix, p.expected_outcome,
           p.risk_summary, p.rollback_plan, p.test_strategy,
           p.proposal_evidence, p.affected_scope,
           p.severity, p.confidence_score, p.business_impact_score, p.risk_score,
           fn_outcome_fix_priority(
             CASE p.severity
               WHEN 'critical' THEN 1.0 WHEN 'high' THEN 0.8
               WHEN 'medium' THEN 0.6 WHEN 'low' THEN 0.4 ELSE 0.2
             END,
             p.business_impact_score, p.confidence_score, p.risk_score
           ) AS priority_score,
           p.expected_kpi_delta_pct_min, p.expected_kpi_delta_pct_max,
           p.review_state, p.review_state_note, p.review_state_changed_at,
           p.expires_at, p.source,
           p.created_at, p.updated_at,
           f.title AS finding_title,
           f.finding_key,
           bi.title AS business_intent_title,
           (SELECT COUNT(*) FROM outcome_fix_reviews r WHERE r.proposal_id = p.id) AS review_count
      FROM outcome_fix_proposals p
      LEFT JOIN outcome_intelligence_findings f ON f.id = p.finding_id
      LEFT JOIN business_intents bi ON bi.id = p.business_intent_id
     WHERE (_state IS NULL OR p.review_state = _state)
       AND (_proposal_type IS NULL OR p.proposal_type = _proposal_type)
       AND (_proposal_source IS NULL OR p.proposal_source = _proposal_source)
       AND (_vertical_key IS NULL OR p.vertical_key = _vertical_key)
       AND (_business_intent_id IS NULL OR p.business_intent_id = _business_intent_id)
     ORDER BY priority_score DESC, p.created_at DESC
     LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN v_rows;
END $$;

-- ============================================================================
-- RPC: admin_get_fix_proposal (with review history)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_fix_proposal(_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v jsonb; v_reviews jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT row_to_jsonb(p) INTO v
    FROM outcome_fix_proposals p WHERE p.id = _proposal_id;
  IF v IS NULL THEN RAISE EXCEPTION 'proposal not found'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_reviews
    FROM outcome_fix_reviews r WHERE r.proposal_id = _proposal_id;

  RETURN jsonb_build_object('proposal', v, 'reviews', v_reviews);
END $$;

-- ============================================================================
-- RPC: admin_get_fix_proposals_summary
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_fix_proposals_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM outcome_fix_proposals),
    'in_review', (SELECT COUNT(*) FROM outcome_fix_proposals WHERE review_state = 'in_review'),
    'changes_requested', (SELECT COUNT(*) FROM outcome_fix_proposals WHERE review_state = 'changes_requested'),
    'approved', (SELECT COUNT(*) FROM outcome_fix_proposals WHERE review_state = 'approved'),
    'rejected', (SELECT COUNT(*) FROM outcome_fix_proposals WHERE review_state = 'rejected'),
    'withdrawn', (SELECT COUNT(*) FROM outcome_fix_proposals WHERE review_state = 'withdrawn'),
    'critical_open', (SELECT COUNT(*) FROM outcome_fix_proposals
                       WHERE review_state IN ('in_review','changes_requested')
                         AND severity = 'critical'),
    'high_open', (SELECT COUNT(*) FROM outcome_fix_proposals
                   WHERE review_state IN ('in_review','changes_requested')
                     AND severity = 'high'),
    'recent_24h', (SELECT COUNT(*) FROM outcome_fix_proposals WHERE created_at >= now() - interval '24 hours'),
    'recent_7d',  (SELECT COUNT(*) FROM outcome_fix_proposals WHERE created_at >= now() - interval '7 days'),
    'avg_priority', (
      SELECT ROUND(AVG(
        fn_outcome_fix_priority(
          CASE severity
            WHEN 'critical' THEN 1.0 WHEN 'high' THEN 0.8
            WHEN 'medium' THEN 0.6 WHEN 'low' THEN 0.4 ELSE 0.2
          END,
          business_impact_score, confidence_score, risk_score
        )
      )::numeric, 4)
      FROM outcome_fix_proposals WHERE review_state IN ('in_review','changes_requested')),
    'by_type', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('proposal_type', t, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT proposal_type::text AS t, COUNT(*) AS c FROM outcome_fix_proposals GROUP BY proposal_type) x),
    'by_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('proposal_source', s, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT proposal_source::text AS s, COUNT(*) AS c FROM outcome_fix_proposals GROUP BY proposal_source) y),
    'by_vertical', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('vertical_key', vertical_key, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT vertical_key, COUNT(*) AS c FROM outcome_fix_proposals GROUP BY vertical_key) z)
  ) INTO v;

  RETURN v;
END $$;

-- Lock everything from anon, expose only to authenticated admins via SECURITY DEFINER
REVOKE ALL ON FUNCTION public.admin_propose_outcome_fix FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_submit_fix_review FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_withdraw_fix_proposal FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_fix_proposals FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_fix_proposal FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_fix_proposals_summary FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_propose_outcome_fix TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_submit_fix_review TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_fix_proposal TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_fix_proposals TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_fix_proposal TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_fix_proposals_summary TO authenticated;

-- Hard rule comment as schema documentation
COMMENT ON TABLE public.outcome_fix_proposals IS
  'BerufAgentOS Cut 2.4 — Controlled Recommendations Layer (HITL). NEVER auto-apply. NEVER deploy. NEVER mutate workflows. Detection -> Proposal -> Review only.';
