
-- ═══════════════════════════════════════════════════
-- PRODUCTION SAFETY NET: SLO Metrics + Synthetic Tests
-- ═══════════════════════════════════════════════════

-- SLO tracking per engine
CREATE TABLE IF NOT EXISTS public.slo_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'hourly',
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  p50_ms NUMERIC,
  p95_ms NUMERIC,
  p99_ms NUMERIC,
  error_rate NUMERIC DEFAULT 0,
  cache_hit_rate NUMERIC DEFAULT 0,
  total_requests INTEGER DEFAULT 0,
  slo_target JSONB DEFAULT '{}',
  slo_met BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_slo_metrics_engine_time ON public.slo_metrics(engine, measured_at DESC);
ALTER TABLE public.slo_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read slo_metrics" ON public.slo_metrics FOR SELECT USING (true);

-- Synthetic test results
CREATE TABLE IF NOT EXISTS public.synthetic_test_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id UUID NOT NULL,
  test_type TEXT NOT NULL DEFAULT 'mini_exam',
  status TEXT NOT NULL DEFAULT 'pending',
  score NUMERIC,
  question_count INTEGER,
  avg_quality_score NUMERIC,
  avg_discrimination NUMERIC,
  coverage_score NUMERIC,
  latency_ms INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_synthetic_tests_curriculum ON public.synthetic_test_results(curriculum_id, created_at DESC);
ALTER TABLE public.synthetic_test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read synthetic_tests" ON public.synthetic_test_results FOR SELECT USING (true);

-- Runbooks
CREATE TABLE IF NOT EXISTS public.runbook_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trigger_event TEXT NOT NULL,
  title TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL DEFAULT 'warning',
  auto_actions JSONB DEFAULT '[]',
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.runbook_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read runbooks" ON public.runbook_entries FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════
-- GROWTH LOOP: Badges, Shares, Referrals
-- ═══════════════════════════════════════════════════

-- User badges
CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  badge_key TEXT NOT NULL,
  badge_label TEXT NOT NULL,
  badge_icon TEXT,
  curriculum_id UUID,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shared_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  UNIQUE(user_id, badge_key, curriculum_id)
);

CREATE INDEX idx_user_badges_user ON public.user_badges(user_id);
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own badges" ON public.user_badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System insert badges" ON public.user_badges FOR INSERT WITH CHECK (true);
CREATE POLICY "Users update own badges" ON public.user_badges FOR UPDATE USING (auth.uid() = user_id);

-- Share events
CREATE TABLE IF NOT EXISTS public.share_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  share_type TEXT NOT NULL,
  share_channel TEXT,
  entity_id UUID,
  entity_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own shares" ON public.share_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own shares" ON public.share_events FOR SELECT USING (auth.uid() = user_id);

-- Referral invites
CREATE TABLE IF NOT EXISTS public.referral_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inviter_id UUID NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  invited_email TEXT,
  claimed_by UUID,
  claimed_at TIMESTAMPTZ,
  reward_granted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referral_invites_code ON public.referral_invites(invite_code);
ALTER TABLE public.referral_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own referrals" ON public.referral_invites FOR SELECT USING (auth.uid() = inviter_id);
CREATE POLICY "Users create referrals" ON public.referral_invites FOR INSERT WITH CHECK (auth.uid() = inviter_id);
CREATE POLICY "Anyone can claim" ON public.referral_invites FOR UPDATE USING (true);

-- ═══════════════════════════════════════════════════
-- CEO DASHBOARD: Aggregated KPI view
-- ═══════════════════════════════════════════════════

-- CEO daily snapshot
CREATE TABLE IF NOT EXISTS public.ceo_daily_kpis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  revenue_eur NUMERIC DEFAULT 0,
  mau INTEGER DEFAULT 0,
  dau INTEGER DEFAULT 0,
  pass_rate_7d NUMERIC,
  pass_rate_14d NUMERIC,
  pass_rate_30d NUMERIC,
  retention_7d NUMERIC,
  retention_30d NUMERIC,
  llm_cost_eur NUMERIC DEFAULT 0,
  cost_per_pass_eur NUMERIC,
  drift_events INTEGER DEFAULT 0,
  churn_rate NUMERIC,
  coach_usage_rate NUMERIC,
  active_subscriptions INTEGER DEFAULT 0,
  new_signups INTEGER DEFAULT 0,
  exam_sessions INTEGER DEFAULT 0,
  avg_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ceo_daily_kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read ceo_kpis" ON public.ceo_daily_kpis FOR SELECT USING (true);

-- Seed default runbooks
INSERT INTO public.runbook_entries (trigger_event, title, severity, steps, auto_actions) VALUES
('drift_rollback', 'Drift-Rollback ausgelöst', 'error', 
 '["1. Prüfe drift_snapshots: Quality-Score Δ", "2. Vergleiche alte vs. neue Prompt-Version", "3. Prüfe canary_releases Status", "4. Bei Bedarf: Manueller Rollback via Admin", "5. Post-Mortem erstellen"]',
 '["canary_manager:rollback", "admin_notification:create"]'),
('slo_breach', 'SLO-Verletzung erkannt', 'warning',
 '["1. Prüfe slo_metrics für betroffene Engine", "2. Prüfe provider_status auf Degradation", "3. Prüfe job_queue auf Überlast", "4. Bei p95 > 10s: Provider-Slots reduzieren", "5. Bei Error-Rate > 5%: Circuit Breaker prüfen"]',
 '["production_guardian:throttle", "admin_notification:create"]'),
('synthetic_test_fail', 'Synthetischer Test fehlgeschlagen', 'error',
 '["1. Prüfe synthetic_test_results für Details", "2. Vergleiche mit letztem erfolgreichen Test", "3. Prüfe exam_questions Pool-Größe", "4. Prüfe Quality-Gates und Coverage", "5. Ggf. Exam-Pool regenerieren"]',
 '["admin_notification:create"]'),
('budget_exceeded', 'Tagesbudget überschritten', 'warning',
 '["1. Prüfe ai_cost_budgets aktuellen Monat", "2. Prüfe ai_usage_log für Top-Verbraucher", "3. Prüfe model_routing_rules Eskalationsrate", "4. Bei Bedarf: Modell-Downshift erzwingen", "5. Budget-Anpassung prüfen"]',
 '["job_runner:pause_expensive", "admin_notification:create"]');
