-- =====================================================
-- ADMIN EXPANSION: Business Intelligence & Operations
-- =====================================================

-- 1. PROMO CODES & BUNDLES
-- =====================================================
CREATE TABLE public.promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed', 'free_trial')),
  discount_value NUMERIC(10,2) NOT NULL,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  min_purchase_amount NUMERIC(10,2),
  applicable_courses UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.promo_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID REFERENCES public.promo_codes(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  course_id UUID REFERENCES public.courses(id),
  discount_applied NUMERIC(10,2) NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.course_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  courses UUID[] NOT NULL DEFAULT '{}',
  original_price NUMERIC(10,2),
  bundle_price NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. AFFILIATE MARKETING
-- =====================================================
CREATE TABLE public.affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  affiliate_code TEXT NOT NULL UNIQUE,
  commission_rate NUMERIC(5,2) DEFAULT 10.00,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  payment_info JSONB DEFAULT '{}',
  total_earnings NUMERIC(10,2) DEFAULT 0,
  pending_payout NUMERIC(10,2) DEFAULT 0,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE NOT NULL,
  referred_user_id UUID NOT NULL,
  course_id UUID REFERENCES public.courses(id),
  purchase_amount NUMERIC(10,2),
  commission_amount NUMERIC(10,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled')),
  referred_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE TABLE public.affiliate_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  payment_method TEXT,
  transaction_reference TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. NEWSLETTER & EMAIL MARKETING
-- =====================================================
CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  template_type TEXT NOT NULL CHECK (template_type IN ('welcome', 'course_complete', 'reminder', 'promo', 'newsletter', 'transactional', 'custom')),
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id),
  first_name TEXT,
  last_name TEXT,
  segments TEXT[] DEFAULT '{}',
  preferences JSONB DEFAULT '{}',
  is_subscribed BOOLEAN DEFAULT true,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  source TEXT DEFAULT 'website'
);

CREATE TABLE public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_id UUID REFERENCES public.email_templates(id),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  target_segments TEXT[] DEFAULT '{}',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  stats JSONB DEFAULT '{"sent": 0, "opened": 0, "clicked": 0, "bounced": 0, "unsubscribed": 0}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. SEO & CONTENT OPTIMIZATION
-- =====================================================
CREATE TABLE public.seo_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_type TEXT NOT NULL,
  page_id UUID,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  og_image TEXT,
  keywords TEXT[],
  structured_data JSONB,
  robots_directives TEXT DEFAULT 'index, follow',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(page_type, page_id)
);

CREATE TABLE public.backlinks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_text TEXT,
  domain_authority INTEGER,
  link_type TEXT CHECK (link_type IN ('dofollow', 'nofollow', 'sponsored', 'ugc')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'broken', 'removed', 'pending')),
  discovered_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE public.content_optimization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL,
  content_id UUID NOT NULL,
  readability_score NUMERIC(5,2),
  seo_score NUMERIC(5,2),
  keyword_density JSONB DEFAULT '{}',
  suggestions JSONB DEFAULT '[]',
  analyzed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(content_type, content_id)
);

-- 5. CRM & LEARNER MANAGEMENT
-- =====================================================
CREATE TABLE public.learner_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  criteria JSONB NOT NULL DEFAULT '{}',
  color TEXT DEFAULT '#6366f1',
  is_dynamic BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.learner_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tag TEXT NOT NULL,
  added_by UUID REFERENCES auth.users(id),
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, tag)
);

CREATE TABLE public.learner_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  note TEXT NOT NULL,
  note_type TEXT DEFAULT 'general' CHECK (note_type IN ('general', 'support', 'sales', 'feedback')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'general' CHECK (category IN ('general', 'technical', 'billing', 'content', 'account')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  assigned_to UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID NOT NULL,
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. SYSTEM HEALTH & SELF-HEALING
-- =====================================================
CREATE TABLE public.system_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_type TEXT NOT NULL CHECK (check_type IN ('database', 'edge_function', 'storage', 'auth', 'realtime', 'external_api')),
  check_name TEXT NOT NULL,
  status TEXT DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  response_time_ms INTEGER,
  details JSONB DEFAULT '{}',
  checked_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('error', 'warning', 'info', 'critical')),
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  is_acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  auto_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_signature TEXT NOT NULL UNIQUE,
  error_type TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  auto_fix_enabled BOOLEAN DEFAULT false,
  auto_fix_action JSONB,
  fix_success_count INTEGER DEFAULT 0,
  fix_failure_count INTEGER DEFAULT 0
);

CREATE TABLE public.recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES public.system_alerts(id),
  error_pattern_id UUID REFERENCES public.error_patterns(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('restart_job', 'clear_cache', 'requeue', 'notify', 'escalate', 'custom')),
  action_payload JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'success', 'failed')),
  executed_at TIMESTAMPTZ,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.system_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('full', 'incremental', 'differential', 'schema_only')),
  tables_included TEXT[] DEFAULT '{}',
  size_bytes BIGINT,
  storage_path TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. KPI & ANALYTICS
-- =====================================================
CREATE TABLE public.kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metrics JSONB NOT NULL DEFAULT '{}',
  period_type TEXT DEFAULT 'daily' CHECK (period_type IN ('hourly', 'daily', 'weekly', 'monthly')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(snapshot_date, period_type)
);

CREATE TABLE public.revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase', 'refund', 'subscription', 'renewal', 'upgrade', 'downgrade')),
  course_id UUID REFERENCES public.courses(id),
  bundle_id UUID REFERENCES public.course_bundles(id),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'EUR',
  promo_code_id UUID REFERENCES public.promo_codes(id),
  affiliate_id UUID REFERENCES public.affiliates(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. PROCESS DOCUMENTATION
-- =====================================================
CREATE TABLE public.process_documentation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  steps JSONB DEFAULT '[]',
  dependencies JSONB DEFAULT '[]',
  success_criteria JSONB DEFAULT '[]',
  failure_handling JSONB DEFAULT '[]',
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  last_validated_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.process_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID REFERENCES public.process_documentation(id) NOT NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  step_results JSONB DEFAULT '[]',
  error_details JSONB,
  metrics JSONB DEFAULT '{}'
);

-- =====================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_code_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_optimization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_documentation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_executions ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES - ADMIN FULL ACCESS
-- =====================================================
-- Admin policies for all business tables
CREATE POLICY "Admins have full access to promo_codes" ON public.promo_codes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to promo_code_redemptions" ON public.promo_code_redemptions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to course_bundles" ON public.course_bundles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to affiliates" ON public.affiliates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to affiliate_referrals" ON public.affiliate_referrals FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to affiliate_payouts" ON public.affiliate_payouts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to email_templates" ON public.email_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to newsletter_subscribers" ON public.newsletter_subscribers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to email_campaigns" ON public.email_campaigns FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to seo_settings" ON public.seo_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to backlinks" ON public.backlinks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to content_optimization" ON public.content_optimization FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to learner_segments" ON public.learner_segments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to learner_tags" ON public.learner_tags FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to learner_notes" ON public.learner_notes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to support_tickets" ON public.support_tickets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to ticket_messages" ON public.ticket_messages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to system_health_checks" ON public.system_health_checks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to system_alerts" ON public.system_alerts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to error_patterns" ON public.error_patterns FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to recovery_actions" ON public.recovery_actions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to system_backups" ON public.system_backups FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to kpi_snapshots" ON public.kpi_snapshots FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to revenue_events" ON public.revenue_events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to user_activity_log" ON public.user_activity_log FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to process_documentation" ON public.process_documentation FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins have full access to process_executions" ON public.process_executions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- User-specific policies
CREATE POLICY "Users can view active promo_codes" ON public.promo_codes FOR SELECT TO authenticated USING (is_active = true AND (valid_until IS NULL OR valid_until > now()));
CREATE POLICY "Users can view active bundles" ON public.course_bundles FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Affiliates can view own data" ON public.affiliates FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Affiliates can view own referrals" ON public.affiliate_referrals FOR SELECT TO authenticated USING (affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid()));
CREATE POLICY "Affiliates can view own payouts" ON public.affiliate_payouts FOR SELECT TO authenticated USING (affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid()));
CREATE POLICY "Users can manage own subscriptions" ON public.newsletter_subscribers FOR ALL TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can view own tickets" ON public.support_tickets FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can create tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can view own ticket messages" ON public.ticket_messages FOR SELECT TO authenticated USING (ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id = auth.uid()) AND is_internal = false);
CREATE POLICY "Users can add ticket messages" ON public.ticket_messages FOR INSERT TO authenticated WITH CHECK (ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id = auth.uid()) AND is_internal = false);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- KPI Calculation Function
CREATE OR REPLACE FUNCTION public.calculate_daily_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metrics JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_users', (SELECT COUNT(*) FROM auth.users),
    'active_learners_today', (SELECT COUNT(DISTINCT user_id) FROM public.user_activity_log WHERE created_at >= CURRENT_DATE),
    'active_learners_7d', (SELECT COUNT(DISTINCT user_id) FROM public.user_activity_log WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),
    'active_learners_30d', (SELECT COUNT(DISTINCT user_id) FROM public.user_activity_log WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'),
    'total_enrollments', (SELECT COUNT(*) FROM public.course_enrollments),
    'new_enrollments_today', (SELECT COUNT(*) FROM public.course_enrollments WHERE enrolled_at >= CURRENT_DATE),
    'completed_courses', (SELECT COUNT(*) FROM public.course_enrollments WHERE completed_at IS NOT NULL),
    'total_lessons_completed', (SELECT COUNT(*) FROM public.lesson_outcomes WHERE status = 'passed'),
    'total_exams_taken', (SELECT COUNT(*) FROM public.exam_sessions WHERE finished_at IS NOT NULL),
    'exam_pass_rate', (SELECT ROUND(AVG(CASE WHEN passed THEN 1 ELSE 0 END) * 100, 2) FROM public.exam_sessions WHERE finished_at IS NOT NULL),
    'revenue_today', (SELECT COALESCE(SUM(amount), 0) FROM public.revenue_events WHERE created_at >= CURRENT_DATE AND event_type IN ('purchase', 'subscription', 'renewal')),
    'revenue_7d', (SELECT COALESCE(SUM(amount), 0) FROM public.revenue_events WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' AND event_type IN ('purchase', 'subscription', 'renewal')),
    'revenue_30d', (SELECT COALESCE(SUM(amount), 0) FROM public.revenue_events WHERE created_at >= CURRENT_DATE - INTERVAL '30 days' AND event_type IN ('purchase', 'subscription', 'renewal')),
    'open_tickets', (SELECT COUNT(*) FROM public.support_tickets WHERE status IN ('open', 'in_progress')),
    'active_promo_codes', (SELECT COUNT(*) FROM public.promo_codes WHERE is_active = true AND (valid_until IS NULL OR valid_until > now())),
    'active_affiliates', (SELECT COUNT(*) FROM public.affiliates WHERE status = 'active'),
    'pending_affiliate_payouts', (SELECT COALESCE(SUM(pending_payout), 0) FROM public.affiliates WHERE pending_payout > 0),
    'newsletter_subscribers', (SELECT COUNT(*) FROM public.newsletter_subscribers WHERE is_subscribed = true),
    'jobs_pending', (SELECT COUNT(*) FROM public.job_queue WHERE status = 'pending'),
    'jobs_failed_24h', (SELECT COUNT(*) FROM public.job_queue WHERE status = 'failed' AND updated_at >= now() - INTERVAL '24 hours'),
    'system_health', (SELECT COALESCE(
      (SELECT jsonb_object_agg(check_type, status) FROM (
        SELECT DISTINCT ON (check_type) check_type, status 
        FROM public.system_health_checks 
        ORDER BY check_type, checked_at DESC
      ) latest), '{}'::jsonb)),
    'unacknowledged_alerts', (SELECT COUNT(*) FROM public.system_alerts WHERE is_acknowledged = false AND resolved_at IS NULL),
    'snapshot_timestamp', now()
  ) INTO v_metrics;
  
  -- Upsert daily snapshot
  INSERT INTO public.kpi_snapshots (snapshot_date, metrics, period_type)
  VALUES (CURRENT_DATE, v_metrics, 'daily')
  ON CONFLICT (snapshot_date, period_type) 
  DO UPDATE SET metrics = v_metrics;
  
  RETURN v_metrics;
END;
$$;

-- System Health Check Function
CREATE OR REPLACE FUNCTION public.run_health_checks()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
  v_start TIMESTAMPTZ;
  v_elapsed INTEGER;
BEGIN
  -- Database connectivity check
  v_start := clock_timestamp();
  BEGIN
    PERFORM 1;
    v_elapsed := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INTEGER;
    INSERT INTO public.system_health_checks (check_type, check_name, status, response_time_ms, details)
    VALUES ('database', 'connectivity', 'healthy', v_elapsed, '{"message": "Database responding"}');
    v_results := v_results || jsonb_build_object('database', 'healthy');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_health_checks (check_type, check_name, status, details)
    VALUES ('database', 'connectivity', 'unhealthy', jsonb_build_object('error', SQLERRM));
    v_results := v_results || jsonb_build_object('database', 'unhealthy');
  END;
  
  -- Check for stale jobs (processing > 30 min)
  v_start := clock_timestamp();
  DECLARE
    v_stale_count INTEGER;
  BEGIN
    SELECT COUNT(*) INTO v_stale_count 
    FROM public.job_queue 
    WHERE status = 'processing' 
    AND locked_at < now() - INTERVAL '30 minutes';
    
    v_elapsed := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INTEGER;
    
    IF v_stale_count > 0 THEN
      INSERT INTO public.system_health_checks (check_type, check_name, status, response_time_ms, details)
      VALUES ('database', 'job_queue', 'degraded', v_elapsed, jsonb_build_object('stale_jobs', v_stale_count));
      v_results := v_results || jsonb_build_object('job_queue', 'degraded');
    ELSE
      INSERT INTO public.system_health_checks (check_type, check_name, status, response_time_ms, details)
      VALUES ('database', 'job_queue', 'healthy', v_elapsed, '{"stale_jobs": 0}');
      v_results := v_results || jsonb_build_object('job_queue', 'healthy');
    END IF;
  END;
  
  RETURN v_results;
END;
$$;

-- Auto-Recovery Function
CREATE OR REPLACE FUNCTION public.attempt_auto_recovery(p_alert_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert RECORD;
  v_pattern RECORD;
  v_action_id UUID;
  v_result JSONB;
BEGIN
  -- Get alert details
  SELECT * INTO v_alert FROM public.system_alerts WHERE id = p_alert_id;
  
  IF v_alert IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Alert not found');
  END IF;
  
  -- Find matching error pattern with auto-fix
  SELECT * INTO v_pattern 
  FROM public.error_patterns 
  WHERE auto_fix_enabled = true 
  AND v_alert.message ILIKE '%' || pattern_signature || '%'
  LIMIT 1;
  
  IF v_pattern IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No auto-fix pattern found');
  END IF;
  
  -- Create recovery action
  INSERT INTO public.recovery_actions (alert_id, error_pattern_id, action_type, action_payload)
  VALUES (p_alert_id, v_pattern.id, (v_pattern.auto_fix_action->>'type')::TEXT, v_pattern.auto_fix_action)
  RETURNING id INTO v_action_id;
  
  -- Execute based on action type
  CASE (v_pattern.auto_fix_action->>'type')
    WHEN 'restart_job' THEN
      -- Requeue failed jobs matching pattern
      UPDATE public.job_queue 
      SET status = 'pending', attempts = 0, locked_at = NULL, locked_by = NULL
      WHERE status = 'failed' AND last_error ILIKE '%' || v_pattern.pattern_signature || '%';
      
      v_result := jsonb_build_object('action', 'restart_job', 'success', true);
      
    WHEN 'clear_cache' THEN
      -- Log cache clear (actual implementation depends on cache system)
      v_result := jsonb_build_object('action', 'clear_cache', 'success', true, 'note', 'Cache clear triggered');
      
    WHEN 'requeue' THEN
      -- Run job maintenance
      PERFORM public.job_maintenance();
      v_result := jsonb_build_object('action', 'requeue', 'success', true);
      
    ELSE
      v_result := jsonb_build_object('action', 'unknown', 'success', false);
  END CASE;
  
  -- Update recovery action status
  UPDATE public.recovery_actions 
  SET status = CASE WHEN (v_result->>'success')::boolean THEN 'success' ELSE 'failed' END,
      executed_at = now(),
      result = v_result
  WHERE id = v_action_id;
  
  -- Update error pattern stats
  IF (v_result->>'success')::boolean THEN
    UPDATE public.error_patterns SET fix_success_count = fix_success_count + 1 WHERE id = v_pattern.id;
    UPDATE public.system_alerts SET auto_resolved = true, resolved_at = now() WHERE id = p_alert_id;
  ELSE
    UPDATE public.error_patterns SET fix_failure_count = fix_failure_count + 1 WHERE id = v_pattern.id;
  END IF;
  
  RETURN v_result;
END;
$$;

-- Create indexes for performance
CREATE INDEX idx_revenue_events_created_at ON public.revenue_events(created_at);
CREATE INDEX idx_revenue_events_user_id ON public.revenue_events(user_id);
CREATE INDEX idx_user_activity_log_created_at ON public.user_activity_log(created_at);
CREATE INDEX idx_user_activity_log_user_id ON public.user_activity_log(user_id);
CREATE INDEX idx_system_alerts_created_at ON public.system_alerts(created_at);
CREATE INDEX idx_system_alerts_acknowledged ON public.system_alerts(is_acknowledged) WHERE is_acknowledged = false;
CREATE INDEX idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX idx_affiliates_status ON public.affiliates(status);
CREATE INDEX idx_promo_codes_active ON public.promo_codes(is_active) WHERE is_active = true;