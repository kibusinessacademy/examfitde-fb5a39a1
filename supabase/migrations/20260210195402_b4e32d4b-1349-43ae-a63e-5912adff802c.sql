
-- ============================================================
-- INTELLIGENCE LAYER: Controlling, CRM & Retention
-- ============================================================

-- Helper function for admin check
CREATE OR REPLACE FUNCTION public.is_admin_user(check_uid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = check_uid AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 1. Learner Intelligence Profiles (Lern-CRM)
CREATE TABLE IF NOT EXISTS public.learner_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  learning_style text,
  pace_category text DEFAULT 'normal',
  frustration_threshold text DEFAULT 'medium',
  motivation_type text,
  risk_areas jsonb DEFAULT '[]'::jsonb,
  exam_readiness_score numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  churn_risk_score numeric DEFAULT 0,
  last_activity_at timestamptz,
  total_learning_minutes integer DEFAULT 0,
  streak_current integer DEFAULT 0,
  streak_best integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.learner_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_learner_profiles" ON public.learner_profiles FOR ALL USING (public.is_admin_user(auth.uid()));
CREATE POLICY "own_learner_profile" ON public.learner_profiles FOR SELECT USING (auth.uid() = user_id);

-- 2. Churn Predictions
CREATE TABLE IF NOT EXISTS public.churn_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  risk_score numeric NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low',
  signals jsonb DEFAULT '[]'::jsonb,
  recommended_action text,
  action_taken text,
  action_taken_at timestamptz,
  predicted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 days')
);
ALTER TABLE public.churn_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_churn_predictions" ON public.churn_predictions FOR ALL USING (public.is_admin_user(auth.uid()));

-- 3. Retention Events
CREATE TABLE IF NOT EXISTS public.retention_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  trigger_reason text,
  payload jsonb DEFAULT '{}'::jsonb,
  channel text DEFAULT 'in_app',
  status text DEFAULT 'pending',
  delivered_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.retention_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_retention_events" ON public.retention_events FOR ALL USING (public.is_admin_user(auth.uid()));
CREATE POLICY "own_retention_events" ON public.retention_events FOR SELECT USING (auth.uid() = user_id);

-- 4. Content Effectiveness
CREATE TABLE IF NOT EXISTS public.content_effectiveness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_title text,
  usage_count integer DEFAULT 0,
  avg_time_minutes numeric DEFAULT 0,
  readiness_impact numeric DEFAULT 0,
  support_tickets_generated integer DEFAULT 0,
  abort_rate numeric DEFAULT 0,
  mastery_rate numeric DEFAULT 0,
  classification text DEFAULT 'medium',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);
ALTER TABLE public.content_effectiveness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_content_effectiveness" ON public.content_effectiveness FOR ALL USING (public.is_admin_user(auth.uid()));

-- 5. Controlling KPI Snapshots
CREATE TABLE IF NOT EXISTS public.controlling_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  kpi_type text NOT NULL,
  kpi_value numeric NOT NULL,
  dimension text,
  dimension_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date, kpi_type, dimension, dimension_id)
);
ALTER TABLE public.controlling_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_controlling_snapshots" ON public.controlling_snapshots FOR ALL USING (public.is_admin_user(auth.uid()));

-- 6. Management Alerts
CREATE TABLE IF NOT EXISTS public.management_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  description text,
  data jsonb DEFAULT '{}'::jsonb,
  source text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.management_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_management_alerts" ON public.management_alerts FOR ALL USING (public.is_admin_user(auth.uid()));

-- 7. Progress Narratives
CREATE TABLE IF NOT EXISTS public.progress_narratives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  narrative_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  icon text,
  metrics jsonb DEFAULT '{}'::jsonb,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.progress_narratives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_progress_narratives" ON public.progress_narratives FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admin_progress_narratives" ON public.progress_narratives FOR ALL USING (public.is_admin_user(auth.uid()));

-- 8. Learner Referrals
CREATE TABLE IF NOT EXISTS public.learner_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL,
  referred_email text,
  referred_user_id uuid,
  referral_code text NOT NULL UNIQUE,
  context_course_id uuid,
  context_exam text,
  status text DEFAULT 'pending',
  reward_type text DEFAULT 'feature_unlock',
  reward_granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.learner_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_referrals_select" ON public.learner_referrals FOR SELECT USING (auth.uid() = referrer_user_id);
CREATE POLICY "own_referrals_insert" ON public.learner_referrals FOR INSERT WITH CHECK (auth.uid() = referrer_user_id);
CREATE POLICY "admin_learner_referrals" ON public.learner_referrals FOR ALL USING (public.is_admin_user(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_learner_profiles_updated_at
  BEFORE UPDATE ON public.learner_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
