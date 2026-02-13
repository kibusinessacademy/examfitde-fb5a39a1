
-- =============================================
-- Quality Shield v3: Deep Audit + Mass Rollout Engine
-- =============================================

-- 1) Deep Audit config table
CREATE TABLE IF NOT EXISTS public.deep_audit_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_days int NOT NULL DEFAULT 3,
  sample_pct numeric NOT NULL DEFAULT 2.0,
  max_drift_delta numeric NOT NULL DEFAULT 5.0,
  auto_hold_on_drift boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz DEFAULT now() + interval '3 days',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deep_audit_config ENABLE ROW LEVEL SECURITY;

-- Insert default config
INSERT INTO public.deep_audit_config (cycle_days, sample_pct, max_drift_delta, auto_hold_on_drift)
VALUES (3, 2.0, 5.0, true)
ON CONFLICT DO NOTHING;

-- Deep audit results
CREATE TABLE IF NOT EXISTS public.deep_audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES public.deep_audit_config(id),
  package_id uuid,
  sampled_count int NOT NULL DEFAULT 0,
  total_questions int NOT NULL DEFAULT 0,
  confidence_before numeric,
  confidence_after numeric,
  confidence_drift numeric,
  governance_before numeric,
  governance_after numeric,
  duplicate_rate_before numeric,
  duplicate_rate_after numeric,
  lf_coverage_before numeric,
  lf_coverage_after numeric,
  difficulty_drift jsonb DEFAULT '{}',
  flags text[] DEFAULT '{}',
  drift_detected boolean NOT NULL DEFAULT false,
  auto_held boolean NOT NULL DEFAULT false,
  findings jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deep_audit_results ENABLE ROW LEVEL SECURITY;

-- 2) Portfolio Priority table for Mass Rollout Engine
CREATE TABLE IF NOT EXISTS public.portfolio_priority (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beruf_id uuid REFERENCES public.berufe(id),
  occupation_slug text,
  demand_score numeric NOT NULL DEFAULT 50,
  revenue_potential_score numeric NOT NULL DEFAULT 50,
  competition_score numeric NOT NULL DEFAULT 50,
  completion_status text NOT NULL DEFAULT 'not_started',
  quality_status text NOT NULL DEFAULT 'unknown',
  confidence numeric DEFAULT 0,
  governance_score numeric DEFAULT 0,
  release_status text NOT NULL DEFAULT 'draft',
  priority_index numeric GENERATED ALWAYS AS (
    0.35 * demand_score + 0.25 * revenue_potential_score + 0.20 * (100 - competition_score) + 0.20 * (CASE WHEN completion_status = 'published' THEN 0 ELSE 80 END)
  ) STORED,
  ship_level text NOT NULL DEFAULT 'ship',
  exam_target int NOT NULL DEFAULT 850,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(beruf_id)
);

ALTER TABLE public.portfolio_priority ENABLE ROW LEVEL SECURITY;

-- 3) Mass rollout control table
CREATE TABLE IF NOT EXISTS public.rollout_control (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'controlled' CHECK (mode IN ('controlled', 'mass_production', 'paused')),
  min_confidence_avg numeric NOT NULL DEFAULT 82,
  min_governance_avg numeric NOT NULL DEFAULT 78,
  max_global_dup_rate numeric NOT NULL DEFAULT 3.0,
  max_provider_risk numeric NOT NULL DEFAULT 60,
  max_concurrent_builds int NOT NULL DEFAULT 4,
  weekly_target int NOT NULL DEFAULT 20,
  auto_upgrade_threshold jsonb DEFAULT '{"min_sales": 10, "min_conversion": 0.05, "min_governance": 85}',
  ship_level_config jsonb DEFAULT '{"ship": 850, "optimize": 1000, "authority": 1200}',
  is_active boolean NOT NULL DEFAULT true,
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rollout_control ENABLE ROW LEVEL SECURITY;

INSERT INTO public.rollout_control (mode, max_concurrent_builds, weekly_target)
VALUES ('controlled', 4, 20)
ON CONFLICT DO NOTHING;

-- 4) RPC: pick_next_package_by_priority (replaces simple queue)
CREATE OR REPLACE FUNCTION public.pick_next_package_by_priority(max_active int DEFAULT 4)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active int;
  v_next_id uuid;
  v_rollout rollout_control%ROWTYPE;
BEGIN
  -- Check rollout control
  SELECT * INTO v_rollout FROM rollout_control WHERE is_active = true LIMIT 1;
  IF v_rollout IS NULL OR v_rollout.mode = 'paused' THEN
    RETURN NULL;
  END IF;

  -- Count active
  SELECT count(*) INTO v_active FROM course_packages WHERE status = 'building';
  IF v_active >= LEAST(max_active, v_rollout.max_concurrent_builds) THEN
    RETURN NULL;
  END IF;

  -- Pick by priority_index from portfolio
  SELECT cp.id INTO v_next_id
  FROM course_packages cp
  JOIN portfolio_priority pp ON pp.beruf_id = cp.certification_id
  WHERE cp.status = 'queued'
    AND cp.council_approved = true
  ORDER BY pp.priority_index DESC, cp.queue_position ASC
  LIMIT 1;

  -- Fallback to standard queue if no portfolio match
  IF v_next_id IS NULL THEN
    SELECT id INTO v_next_id
    FROM course_packages
    WHERE status = 'queued' AND council_approved = true
    ORDER BY queue_position ASC
    LIMIT 1;
  END IF;

  RETURN v_next_id;
END;
$$;

-- 5) RPC: evaluate_rollout_readiness
CREATE OR REPLACE FUNCTION public.evaluate_rollout_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg_conf numeric;
  v_avg_gov numeric;
  v_global_dup numeric;
  v_max_risk numeric;
  v_ctrl rollout_control%ROWTYPE;
  v_ready boolean;
  v_reasons text[] := '{}';
BEGIN
  SELECT * INTO v_ctrl FROM rollout_control WHERE is_active = true LIMIT 1;
  IF v_ctrl IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'reason', 'No rollout_control config');
  END IF;

  -- Avg confidence from latest snapshots per package
  SELECT COALESCE(avg(confidence_score), 0) INTO v_avg_conf
  FROM (
    SELECT DISTINCT ON (package_id) confidence_score
    FROM production_quality_snapshots
    ORDER BY package_id, snapshot_at DESC
  ) sub;

  -- Avg governance from latest audit snapshots
  SELECT COALESCE(avg(governance_score), 0) INTO v_avg_gov
  FROM (
    SELECT DISTINCT ON (package_id) governance_score
    FROM quality_audit_snapshots
    ORDER BY package_id, created_at DESC
  ) sub;

  -- Global dup rate
  SELECT COALESCE(avg(duplicate_rate), 0) INTO v_global_dup
  FROM (
    SELECT DISTINCT ON (package_id) duplicate_rate
    FROM production_quality_snapshots
    ORDER BY package_id, snapshot_at DESC
  ) sub;

  -- Max provider risk
  SELECT COALESCE(max(risk_score), 0) INTO v_max_risk
  FROM provider_performance
  WHERE date = current_date::text;

  v_ready := true;

  IF v_avg_conf < v_ctrl.min_confidence_avg THEN
    v_ready := false;
    v_reasons := array_append(v_reasons, 'Confidence avg ' || round(v_avg_conf, 1) || ' < ' || v_ctrl.min_confidence_avg);
  END IF;
  IF v_avg_gov < v_ctrl.min_governance_avg THEN
    v_ready := false;
    v_reasons := array_append(v_reasons, 'Governance avg ' || round(v_avg_gov, 1) || ' < ' || v_ctrl.min_governance_avg);
  END IF;
  IF v_global_dup > v_ctrl.max_global_dup_rate THEN
    v_ready := false;
    v_reasons := array_append(v_reasons, 'Global dup rate ' || round(v_global_dup, 1) || '% > ' || v_ctrl.max_global_dup_rate || '%');
  END IF;
  IF v_max_risk > v_ctrl.max_provider_risk THEN
    v_ready := false;
    v_reasons := array_append(v_reasons, 'Provider risk ' || v_max_risk || ' > ' || v_ctrl.max_provider_risk);
  END IF;

  -- Auto-switch mode
  IF v_ready AND v_ctrl.mode = 'controlled' THEN
    UPDATE rollout_control SET mode = 'mass_production', last_evaluated_at = now() WHERE id = v_ctrl.id;
  ELSIF NOT v_ready AND v_ctrl.mode = 'mass_production' THEN
    UPDATE rollout_control SET mode = 'controlled', last_evaluated_at = now() WHERE id = v_ctrl.id;
  END IF;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'mode', CASE WHEN v_ready THEN 'mass_production' ELSE 'controlled' END,
    'avg_confidence', round(v_avg_conf, 1),
    'avg_governance', round(v_avg_gov, 1),
    'global_dup_rate', round(v_global_dup, 1),
    'max_provider_risk', v_max_risk,
    'issues', v_reasons
  );
END;
$$;
