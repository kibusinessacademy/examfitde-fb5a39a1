
BEGIN;

-- 1. BUDGET CAPS
CREATE TABLE IF NOT EXISTS public.executive_budget_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_key text NOT NULL UNIQUE,
  scope_type text NOT NULL DEFAULT 'layer',
  scope_ref text,
  period_type text NOT NULL DEFAULT 'daily',
  budget_limit numeric NOT NULL DEFAULT 0,
  warning_threshold numeric NOT NULL DEFAULT 0.8,
  critical_threshold numeric NOT NULL DEFAULT 1.0,
  action_on_warning text NOT NULL DEFAULT 'alert',
  action_on_critical text NOT NULL DEFAULT 'throttle',
  is_enabled boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_budget_caps_scope_chk CHECK (scope_type IN ('layer','channel','portfolio','global')),
  CONSTRAINT executive_budget_caps_period_chk CHECK (period_type IN ('daily','weekly','monthly')),
  CONSTRAINT executive_budget_caps_action_warn_chk CHECK (action_on_warning IN ('alert','hold','throttle')),
  CONSTRAINT executive_budget_caps_action_crit_chk CHECK (action_on_critical IN ('alert','hold','throttle','pause'))
);

INSERT INTO public.executive_budget_caps (cap_key, scope_type, scope_ref, period_type, budget_limit, warning_threshold, critical_threshold, action_on_warning, action_on_critical)
VALUES
  ('global_daily_budget', 'global', 'system', 'daily', 500, 0.8, 1.0, 'alert', 'throttle'),
  ('production_daily_budget', 'layer', 'production', 'daily', 180, 0.8, 1.0, 'alert', 'throttle'),
  ('campaigns_daily_budget', 'layer', 'campaigns', 'daily', 120, 0.8, 1.0, 'alert', 'hold'),
  ('distribution_daily_budget', 'layer', 'distribution', 'daily', 60, 0.85, 1.0, 'alert', 'hold'),
  ('optimization_daily_budget', 'layer', 'optimization', 'daily', 40, 0.85, 1.0, 'alert', 'hold')
ON CONFLICT (cap_key) DO NOTHING;

-- 2. PORTFOLIO ALLOCATIONS
CREATE TABLE IF NOT EXISTS public.executive_portfolio_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_key text NOT NULL UNIQUE,
  segment_type text NOT NULL,
  segment_value text NOT NULL,
  target_share numeric NOT NULL DEFAULT 0,
  actual_share numeric NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'balanced',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_portfolio_allocations_status_chk CHECK (status IN ('underweight','balanced','overweight'))
);

INSERT INTO public.executive_portfolio_allocations (allocation_key, segment_type, segment_value, target_share, actual_share, score, status)
VALUES
  ('award_type_meister', 'award_type', 'meister', 0.30, 0, 0, 'balanced'),
  ('award_type_fachwirt', 'award_type', 'fachwirt', 0.30, 0, 0, 'balanced'),
  ('award_type_betriebswirt', 'award_type', 'betriebswirt', 0.15, 0, 0, 'balanced'),
  ('award_type_bilanzbuchhalter', 'award_type', 'bilanzbuchhalter', 0.10, 0, 0, 'balanced'),
  ('award_type_sonstige', 'award_type', 'other', 0.15, 0, 0, 'balanced')
ON CONFLICT (allocation_key) DO NOTHING;

-- 3. PORTFOLIO DECISIONS
CREATE TABLE IF NOT EXISTS public.executive_portfolio_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_scope text NOT NULL,
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  wave_id uuid REFERENCES public.production_waves(id) ON DELETE CASCADE,
  channel_key text,
  decision_type text NOT NULL,
  decision_status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 5,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT executive_portfolio_decisions_scope_chk CHECK (decision_scope IN ('curriculum','wave','channel','layer','portfolio')),
  CONSTRAINT executive_portfolio_decisions_type_chk CHECK (decision_type IN ('promote_curriculum','hold_curriculum','pause_curriculum','kill_curriculum','approve_wave','block_wave','pause_wave','scale_channel','hold_channel','throttle_layer','rebalance_portfolio')),
  CONSTRAINT executive_portfolio_decisions_status_chk CHECK (decision_status IN ('queued','processing','done','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS idx_executive_portfolio_decisions_lookup ON public.executive_portfolio_decisions (decision_status, priority DESC, created_at ASC);

-- 4. KILL SWITCHES
CREATE TABLE IF NOT EXISTS public.executive_kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  switch_key text NOT NULL UNIQUE,
  scope_type text NOT NULL,
  scope_ref text,
  is_active boolean NOT NULL DEFAULT false,
  activated_reason text,
  activated_by text NOT NULL DEFAULT 'system',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_kill_switches_scope_chk CHECK (scope_type IN ('global','layer','channel','wave','curriculum'))
);

INSERT INTO public.executive_kill_switches (switch_key, scope_type, scope_ref, is_active, activated_reason)
VALUES
  ('global_emergency_stop', 'global', 'system', false, null),
  ('production_pause_switch', 'layer', 'production', false, null),
  ('campaign_pause_switch', 'layer', 'campaigns', false, null),
  ('distribution_pause_switch', 'layer', 'distribution', false, null)
ON CONFLICT (switch_key) DO NOTHING;

-- 5. EXECUTIVE SUMMARY REPORTS
CREATE TABLE IF NOT EXISTS public.executive_summary_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_period text NOT NULL DEFAULT 'daily',
  report_date date NOT NULL DEFAULT current_date,
  headline text,
  health_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  finance_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  portfolio_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  wave_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  decisions_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_summary_reports_period_chk CHECK (report_period IN ('daily','weekly','monthly'))
);

CREATE INDEX IF NOT EXISTS idx_executive_summary_reports_date ON public.executive_summary_reports (report_date DESC, report_period);

-- 6. REBALANCE RUNS
CREATE TABLE IF NOT EXISTS public.executive_rebalance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_period text NOT NULL DEFAULT 'daily',
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  decisions_created integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT executive_rebalance_runs_period_chk CHECK (run_period IN ('daily','weekly','monthly','manual')),
  CONSTRAINT executive_rebalance_runs_status_chk CHECK (status IN ('running','done','failed'))
);

COMMIT;
