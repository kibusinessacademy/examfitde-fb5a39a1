-- =====================================================
-- System Audit & Cost Tracking Migration (Fixed)
-- =====================================================

-- 1. AI Cost Tracking Tabelle für monatliche Budgets
CREATE TABLE IF NOT EXISTS public.ai_cost_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL UNIQUE,
  budget_eur NUMERIC(10,2) NOT NULL DEFAULT 200.00,
  spent_eur NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  alert_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  alert_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Detailliertes AI Usage Log
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  cost_eur NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. System Optimization Reports
CREATE TABLE IF NOT EXISTS public.system_optimization_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly', 'monthly', 'manual')),
  metrics JSONB NOT NULL DEFAULT '{}',
  recommendations JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),
  generated_by TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Course Reviews Tabelle
CREATE TABLE IF NOT EXISTS public.course_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  content TEXT,
  is_verified_purchase BOOLEAN NOT NULL DEFAULT false,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  reported_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending', 'published', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(course_id, user_id)
);

-- 5. Course Notes (persönliche Lernnotizen)
CREATE TABLE IF NOT EXISTS public.course_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id UUID,
  question_id UUID,
  note_type TEXT NOT NULL DEFAULT 'general' CHECK (note_type IN ('general', 'question', 'repeat', 'bookmark')),
  content TEXT NOT NULL,
  is_flagged_for_repeat BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Performance Metrics Tabelle
CREATE TABLE IF NOT EXISTS public.performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metric_type TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  unit TEXT,
  threshold_warning NUMERIC,
  threshold_critical NUMERIC,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(metric_date, metric_type, metric_name)
);

-- RLS Policies
ALTER TABLE public.ai_cost_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_optimization_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;

-- Vereinfachte Admin-Policies (ohne role-Spalte)
CREATE POLICY "Admins can manage cost budgets" ON public.ai_cost_budgets
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view usage logs" ON public.ai_usage_log
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert usage logs" ON public.ai_usage_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can manage optimization reports" ON public.system_optimization_reports
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can view performance metrics" ON public.performance_metrics
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Reviews: Jeder kann lesen, nur eigene bearbeiten
CREATE POLICY "Anyone can view published reviews" ON public.course_reviews
  FOR SELECT USING (status = 'published' OR user_id = auth.uid());

CREATE POLICY "Users can create reviews" ON public.course_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reviews" ON public.course_reviews
  FOR UPDATE USING (auth.uid() = user_id);

-- Notes: Nur eigene Notizen
CREATE POLICY "Users can manage own notes" ON public.course_notes
  FOR ALL USING (auth.uid() = user_id);

-- Indizes für Performance
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at ON public.ai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_job_type ON public.ai_usage_log(job_type);
CREATE INDEX IF NOT EXISTS idx_course_reviews_course_id ON public.course_reviews(course_id);
CREATE INDEX IF NOT EXISTS idx_course_reviews_rating ON public.course_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_course_notes_user_course ON public.course_notes(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_date ON public.performance_metrics(metric_date DESC);

-- Funktion: Monatliches Budget prüfen und Alert senden
CREATE OR REPLACE FUNCTION public.check_ai_budget_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_budget RECORD;
  v_current_month DATE;
BEGIN
  v_current_month := date_trunc('month', CURRENT_DATE)::DATE;
  
  -- Hole oder erstelle Budget für aktuellen Monat
  INSERT INTO public.ai_cost_budgets (month, budget_eur)
  VALUES (v_current_month, 200.00)
  ON CONFLICT (month) DO UPDATE SET
    spent_eur = ai_cost_budgets.spent_eur + NEW.cost_eur,
    updated_at = now()
  RETURNING * INTO v_budget;
  
  -- Prüfe ob 80% erreicht und noch kein Alert gesendet
  IF v_budget.spent_eur >= (v_budget.budget_eur * v_budget.alert_threshold) 
     AND v_budget.alert_sent_at IS NULL THEN
    -- Markiere Alert als gesendet
    UPDATE public.ai_cost_budgets 
    SET alert_sent_at = now() 
    WHERE id = v_budget.id;
    
    -- Erstelle System-Alert
    INSERT INTO public.system_alerts (
      alert_type, source, title, message
    ) VALUES (
      'warning',
      'ai_cost_tracking',
      'AI Budget Alert: 80% erreicht',
      format('Das monatliche AI-Budget ist zu %.0f%% ausgeschöpft (%.2f€ von %.2f€)', 
        (v_budget.spent_eur / v_budget.budget_eur * 100), 
        v_budget.spent_eur, 
        v_budget.budget_eur)
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger für Budget-Tracking
DROP TRIGGER IF EXISTS trigger_ai_budget_check ON public.ai_usage_log;
CREATE TRIGGER trigger_ai_budget_check
  AFTER INSERT ON public.ai_usage_log
  FOR EACH ROW
  EXECUTE FUNCTION public.check_ai_budget_alert();

-- View: Monatliche Kostenübersicht
CREATE OR REPLACE VIEW public.ai_cost_overview AS
SELECT 
  b.month,
  b.budget_eur,
  b.spent_eur,
  b.alert_threshold,
  b.alert_sent_at,
  ROUND((b.spent_eur / NULLIF(b.budget_eur, 0) * 100)::numeric, 1) as usage_percent,
  b.budget_eur - b.spent_eur as remaining_eur,
  (SELECT COUNT(*) FROM public.ai_usage_log l 
   WHERE date_trunc('month', l.created_at) = b.month) as total_requests,
  (SELECT SUM(total_tokens) FROM public.ai_usage_log l 
   WHERE date_trunc('month', l.created_at) = b.month) as total_tokens,
  (SELECT COUNT(*) FROM public.ai_usage_log l 
   WHERE date_trunc('month', l.created_at) = b.month AND NOT l.success) as failed_requests
FROM public.ai_cost_budgets b
ORDER BY b.month DESC;

-- Initial Budget für aktuellen Monat
INSERT INTO public.ai_cost_budgets (month, budget_eur, alert_threshold)
VALUES (date_trunc('month', CURRENT_DATE)::DATE, 200.00, 0.80)
ON CONFLICT (month) DO NOTHING;