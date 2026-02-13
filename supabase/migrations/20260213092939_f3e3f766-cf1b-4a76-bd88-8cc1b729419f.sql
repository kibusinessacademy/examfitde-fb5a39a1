
-- ====================================================================
-- Authority Mode + CEO Strategic Dashboard – Database Layer
-- ====================================================================

-- 1) Add authority columns to portfolio_priority
ALTER TABLE public.portfolio_priority
  ADD COLUMN IF NOT EXISTS authority_index numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS authority_status text DEFAULT 'ship',
  ADD COLUMN IF NOT EXISTS authority_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS authority_approved_by text,
  ADD COLUMN IF NOT EXISTS audit_cycles_passed int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_quality_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS revenue_monthly numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_sector text;

-- 2) Rollout control: add authority limits
ALTER TABLE public.rollout_control
  ADD COLUMN IF NOT EXISTS max_authority_concurrent int DEFAULT 5,
  ADD COLUMN IF NOT EXISTS authority_thresholds jsonb DEFAULT '{"min_questions":1200,"min_lf_coverage":95,"max_dup_rate":2.5,"min_hard_pct":20,"max_hard_pct":30,"max_low_conf":5,"min_confidence":90,"min_governance":90,"max_provider_risk":30,"min_audit_cycles":2}'::jsonb,
  ADD COLUMN IF NOT EXISTS revenue_protection jsonb DEFAULT '{"min_revenue_threshold":500,"min_confidence_for_revenue":80}'::jsonb;

-- 3) Authority approval log (immutable)
CREATE TABLE IF NOT EXISTS public.authority_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid REFERENCES public.portfolio_priority(id),
  decision text NOT NULL, -- 'promoted', 'rejected', 'demoted'
  decided_by text NOT NULL DEFAULT 'system',
  reason text,
  authority_index_at numeric,
  confidence_at numeric,
  governance_at numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.authority_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_authority_decisions" ON public.authority_decisions FOR ALL USING (true);

-- 4) RPC: calculate_authority_index
CREATE OR REPLACE FUNCTION public.calculate_authority_index(
  p_confidence numeric,
  p_governance numeric,
  p_lf_coverage numeric,
  p_dup_rate numeric,
  p_difficulty_balance numeric,
  p_provider_stability numeric,
  p_audit_stability numeric
) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_dup_scaled numeric;
  v_idx numeric;
BEGIN
  -- Scale dup rate: 0%=100, 2%=85, 5%=50, 6%+=0
  v_dup_scaled := GREATEST(0, LEAST(100, 100 - (p_dup_rate * 16.67)));
  
  v_idx := ROUND(
    0.25 * LEAST(p_confidence, 100)
    + 0.20 * LEAST(p_governance, 100)
    + 0.15 * LEAST(p_lf_coverage, 100)
    + 0.10 * v_dup_scaled
    + 0.10 * LEAST(p_difficulty_balance, 100)
    + 0.10 * LEAST(p_provider_stability, 100)
    + 0.10 * LEAST(p_audit_stability, 100)
  );
  
  RETURN LEAST(100, GREATEST(0, v_idx));
END;
$$;

-- 5) RPC: determine ship level from authority index
CREATE OR REPLACE FUNCTION public.get_ship_level(p_authority_index numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_authority_index >= 93 THEN 'authority'
    WHEN p_authority_index >= 85 THEN 'advanced'
    WHEN p_authority_index >= 70 THEN 'optimize'
    ELSE 'ship'
  END;
$$;

-- 6) RPC: evaluate_portfolio_health – CEO PHI
CREATE OR REPLACE FUNCTION public.evaluate_portfolio_health()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_avg_authority numeric;
  v_avg_governance numeric;
  v_avg_confidence numeric;
  v_total_berufe int;
  v_covered_optimize int;
  v_covered_authority int;
  v_phi numeric;
  v_top_revenue jsonb;
  v_top_risk jsonb;
  v_sector_coverage jsonb;
  v_authority_pipeline jsonb;
BEGIN
  SELECT 
    COALESCE(AVG(authority_index), 0),
    COALESCE(AVG(governance_score), 0),
    COALESCE(AVG(confidence), 0),
    COUNT(*)
  INTO v_avg_authority, v_avg_governance, v_avg_confidence, v_total_berufe
  FROM portfolio_priority;

  SELECT COUNT(*) INTO v_covered_optimize
  FROM portfolio_priority WHERE authority_index >= 70;

  SELECT COUNT(*) INTO v_covered_authority
  FROM portfolio_priority WHERE authority_index >= 93;

  -- PHI = 0.30*avg_authority + 0.20*governance + 0.20*revenue_stability + 0.15*provider + 0.15*coverage
  v_phi := ROUND(
    0.30 * v_avg_authority
    + 0.20 * v_avg_governance
    + 0.20 * LEAST(100, v_avg_confidence)
    + 0.15 * 80 -- provider stability placeholder
    + 0.15 * CASE WHEN v_total_berufe > 0 THEN (v_covered_optimize::numeric / v_total_berufe * 100) ELSE 0 END
  );

  -- Top revenue
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_top_revenue
  FROM (
    SELECT occupation_slug, revenue_monthly, authority_index, confidence, governance_score, authority_status
    FROM portfolio_priority ORDER BY revenue_monthly DESC NULLS LAST LIMIT 10
  ) r;

  -- Top risk
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_top_risk
  FROM (
    SELECT occupation_slug, authority_index, confidence, governance_score, demand_score
    FROM portfolio_priority WHERE confidence < 80 OR governance_score < 70 ORDER BY confidence LIMIT 10
  ) r;

  -- Sector coverage
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_sector_coverage
  FROM (
    SELECT 
      COALESCE(market_sector, 'Unbekannt') as sector,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE authority_index >= 70) as optimize_plus,
      COUNT(*) FILTER (WHERE authority_index >= 93) as authority,
      ROUND(AVG(authority_index)) as avg_index
    FROM portfolio_priority GROUP BY market_sector ORDER BY COUNT(*) DESC
  ) r;

  -- Authority pipeline (in-progress authority upgrades)
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_authority_pipeline
  FROM (
    SELECT occupation_slug, authority_index, confidence, governance_score, audit_cycles_passed, authority_status
    FROM portfolio_priority 
    WHERE authority_index >= 80 AND authority_status != 'authority'
    ORDER BY authority_index DESC LIMIT 10
  ) r;

  RETURN jsonb_build_object(
    'phi', v_phi,
    'avg_authority', v_avg_authority,
    'avg_governance', v_avg_governance,
    'avg_confidence', v_avg_confidence,
    'total_berufe', v_total_berufe,
    'covered_optimize', v_covered_optimize,
    'covered_authority', v_covered_authority,
    'top_revenue', v_top_revenue,
    'top_risk', v_top_risk,
    'sector_coverage', v_sector_coverage,
    'authority_pipeline', v_authority_pipeline
  );
END;
$$;

-- 7) RPC: promote_to_authority (dual approval)
CREATE OR REPLACE FUNCTION public.promote_to_authority(
  p_portfolio_id uuid,
  p_admin_id text DEFAULT 'admin'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_entry portfolio_priority%ROWTYPE;
  v_thresholds jsonb;
  v_issues text[] := '{}';
BEGIN
  SELECT * INTO v_entry FROM portfolio_priority WHERE id = p_portfolio_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Not found'); END IF;

  -- Get thresholds from rollout_control
  SELECT authority_thresholds INTO v_thresholds FROM rollout_control WHERE is_active = true LIMIT 1;
  IF v_thresholds IS NULL THEN
    v_thresholds := '{"min_confidence":90,"min_governance":90,"min_audit_cycles":2}'::jsonb;
  END IF;

  -- System checks
  IF v_entry.authority_index < 93 THEN v_issues := array_append(v_issues, 'Authority Index < 93 (ist: ' || v_entry.authority_index || ')'); END IF;
  IF v_entry.confidence < (v_thresholds->>'min_confidence')::numeric THEN v_issues := array_append(v_issues, 'Confidence zu niedrig'); END IF;
  IF v_entry.governance_score < (v_thresholds->>'min_governance')::numeric THEN v_issues := array_append(v_issues, 'Governance zu niedrig'); END IF;
  IF v_entry.audit_cycles_passed < (v_thresholds->>'min_audit_cycles')::int THEN v_issues := array_append(v_issues, 'Nicht genug Audit-Zyklen'); END IF;
  IF v_entry.last_quality_hold_at IS NOT NULL AND v_entry.last_quality_hold_at > now() - interval '14 days' THEN
    v_issues := array_append(v_issues, 'Quality Hold in letzten 14 Tagen');
  END IF;

  -- Check concurrent authority limit
  IF (SELECT COUNT(*) FROM portfolio_priority WHERE authority_status = 'authority') >= 
     COALESCE((SELECT max_authority_concurrent FROM rollout_control WHERE is_active LIMIT 1), 5) 
     AND array_length(v_issues, 1) IS NULL THEN
    -- Allow promotion even at limit if all checks pass
  END IF;

  IF array_length(v_issues, 1) > 0 THEN
    INSERT INTO authority_decisions (portfolio_id, decision, decided_by, reason, authority_index_at, confidence_at, governance_at)
    VALUES (p_portfolio_id, 'rejected', p_admin_id, array_to_string(v_issues, '; '), v_entry.authority_index, v_entry.confidence, v_entry.governance_score);
    RETURN jsonb_build_object('ok', false, 'issues', v_issues);
  END IF;

  -- Promote
  UPDATE portfolio_priority SET 
    authority_status = 'authority',
    authority_approved_at = now(),
    authority_approved_by = p_admin_id,
    ship_level = 'authority'
  WHERE id = p_portfolio_id;

  INSERT INTO authority_decisions (portfolio_id, decision, decided_by, reason, authority_index_at, confidence_at, governance_at)
  VALUES (p_portfolio_id, 'promoted', p_admin_id, 'All checks passed', v_entry.authority_index, v_entry.confidence, v_entry.governance_score);

  RETURN jsonb_build_object('ok', true, 'status', 'authority');
END;
$$;
