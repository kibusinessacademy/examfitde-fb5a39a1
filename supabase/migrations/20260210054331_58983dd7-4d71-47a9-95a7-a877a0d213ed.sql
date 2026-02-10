
-- Marketing Plans (Monthly strategy from Chief Growth Strategist)
CREATE TABLE public.marketing_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL UNIQUE,
  strategy_json JSONB NOT NULL DEFAULT '{}',
  budget_total NUMERIC(10,2) NOT NULL DEFAULT 100.00,
  budget_split JSONB NOT NULL DEFAULT '{"seo": 0, "paid": 0, "email": 0, "content": 0, "reserve": 0}',
  hypotheses JSONB NOT NULL DEFAULT '[]',
  priorities TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'validated', 'approved', 'active', 'completed')),
  validation_score NUMERIC(5,2),
  validation_report JSONB,
  validated_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  llm_used TEXT NOT NULL DEFAULT 'openai/gpt-5.2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marketing Campaigns
CREATE TABLE public.marketing_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.marketing_plans(id),
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('seo', 'paid_google', 'paid_meta', 'email', 'social', 'affiliate', 'content')),
  target_groups TEXT[] NOT NULL DEFAULT '{}',
  hypothesis TEXT,
  budget_allocated NUMERIC(10,2) NOT NULL DEFAULT 0,
  budget_spent NUMERIC(10,2) NOT NULL DEFAULT 0,
  kpis JSONB NOT NULL DEFAULT '{}',
  kill_switch_rules JSONB NOT NULL DEFAULT '{"max_days_without_conversion": 7, "min_ctr": 0.5}',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'validated', 'live', 'paused', 'stopped', 'completed')),
  validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending', 'approved', 'revised', 'rejected')),
  validation_report JSONB,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  stop_reason TEXT,
  metrics JSONB NOT NULL DEFAULT '{"impressions": 0, "clicks": 0, "conversions": 0, "revenue": 0}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marketing Assets (content produced by DeepSeek / GPT)
CREATE TABLE public.marketing_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.marketing_campaigns(id),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('blog', 'landing_page', 'email', 'social_post', 'ad_copy', 'affiliate_material', 'newsletter')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_group TEXT NOT NULL,
  llm_used TEXT NOT NULL DEFAULT 'deepseek-chat',
  template_used TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'validated', 'approved', 'published', 'rejected')),
  validation_score NUMERIC(5,2),
  validation_report JSONB,
  legal_check_passed BOOLEAN DEFAULT false,
  seo_score NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marketing Experiments (A/B tests)
CREATE TABLE public.marketing_experiments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.marketing_campaigns(id),
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  variant_a JSONB NOT NULL,
  variant_b JSONB NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{"variant_a": {}, "variant_b": {}}',
  winner TEXT CHECK (winner IN ('a', 'b', 'inconclusive')),
  sample_size_target INTEGER NOT NULL DEFAULT 100,
  current_sample_size INTEGER NOT NULL DEFAULT 0,
  confidence_level NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  learnings TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budget Requests (governance)
CREATE TABLE public.marketing_budget_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.marketing_plans(id),
  requested_amount NUMERIC(10,2) NOT NULL,
  current_budget NUMERIC(10,2) NOT NULL,
  campaign_name TEXT NOT NULL,
  justification JSONB NOT NULL DEFAULT '{}',
  proof JSONB NOT NULL DEFAULT '{}',
  expected_roi NUMERIC(5,2),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marketing Learnings (feedback loop)
CREATE TABLE public.marketing_learnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('experiment', 'campaign', 'funnel', 'user_feedback', 'sales_data')),
  source_id UUID,
  learning TEXT NOT NULL,
  impact_area TEXT NOT NULL CHECK (impact_area IN ('product', 'pricing', 'messaging', 'channel', 'targeting', 'didactics')),
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.marketing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_budget_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_learnings ENABLE ROW LEVEL SECURITY;

-- Admin-only policies (all marketing tables are admin-managed)
CREATE POLICY "Admin full access marketing_plans" ON public.marketing_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access marketing_campaigns" ON public.marketing_campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access marketing_assets" ON public.marketing_assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access marketing_experiments" ON public.marketing_experiments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access marketing_budget_requests" ON public.marketing_budget_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access marketing_learnings" ON public.marketing_learnings FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_marketing_campaigns_plan ON public.marketing_campaigns(plan_id);
CREATE INDEX idx_marketing_campaigns_status ON public.marketing_campaigns(status);
CREATE INDEX idx_marketing_assets_campaign ON public.marketing_assets(campaign_id);
CREATE INDEX idx_marketing_assets_status ON public.marketing_assets(status);
CREATE INDEX idx_marketing_experiments_campaign ON public.marketing_experiments(campaign_id);
CREATE INDEX idx_marketing_budget_requests_status ON public.marketing_budget_requests(status);

-- Update trigger
CREATE TRIGGER update_marketing_plans_updated_at BEFORE UPDATE ON public.marketing_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_marketing_campaigns_updated_at BEFORE UPDATE ON public.marketing_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_marketing_assets_updated_at BEFORE UPDATE ON public.marketing_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
