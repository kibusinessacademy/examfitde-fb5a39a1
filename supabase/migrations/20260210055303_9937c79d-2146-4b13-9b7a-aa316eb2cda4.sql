
-- =============================================
-- EXAMFIT COUNCIL OPERATING SYSTEM (ECOS)
-- =============================================

-- Council registry
CREATE TABLE public.councils (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mission TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  budget_eur_monthly NUMERIC DEFAULT 0,
  budget_spent_eur NUMERIC DEFAULT 0,
  generator_model TEXT DEFAULT 'openai/gpt-5.2',
  validator_model TEXT DEFAULT 'claude-opus-4.6',
  producer_model TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Council KPIs
CREATE TABLE public.council_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id TEXT NOT NULL REFERENCES public.councils(id) ON DELETE CASCADE,
  kpi_name TEXT NOT NULL,
  kpi_value NUMERIC,
  target_value NUMERIC,
  unit TEXT DEFAULT '%',
  period TEXT NOT NULL DEFAULT 'monthly',
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT DEFAULT 'on_track' CHECK (status IN ('on_track', 'at_risk', 'critical')),
  metadata JSONB DEFAULT '{}'
);

-- Council decisions (cross-council)
CREATE TABLE public.council_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id TEXT NOT NULL REFERENCES public.councils(id) ON DELETE CASCADE,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('plan', 'execute', 'validate', 'approve', 'reject', 'escalate', 'kill')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'escalated', 'auto_approved')),
  requires_councils TEXT[] DEFAULT '{}',
  approvals JSONB DEFAULT '{}',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Council escalations
CREATE TABLE public.council_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_council_id TEXT NOT NULL REFERENCES public.councils(id) ON DELETE CASCADE,
  target_council_id TEXT REFERENCES public.councils(id),
  escalation_type TEXT NOT NULL CHECK (escalation_type IN ('conflict', 'budget', 'quality', 'risk', 'compliance', 'technical')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kill switches
CREATE TABLE public.council_kill_switches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id TEXT NOT NULL REFERENCES public.councils(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  kpi_name TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN ('>', '<', '>=', '<=', '=')),
  threshold NUMERIC NOT NULL,
  action TEXT NOT NULL DEFAULT 'pause' CHECK (action IN ('pause', 'rollback', 'alert', 'disable')),
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Council activity log
CREATE TABLE public.council_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id TEXT NOT NULL REFERENCES public.councils(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  agent_role TEXT,
  llm_model TEXT,
  input_summary TEXT,
  output_summary TEXT,
  cost_eur NUMERIC DEFAULT 0,
  duration_ms INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.councils ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_kill_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_activity_log ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admins can manage councils" ON public.councils FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage council_kpis" ON public.council_kpis FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage council_decisions" ON public.council_decisions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage council_escalations" ON public.council_escalations FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage council_kill_switches" ON public.council_kill_switches FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage council_activity_log" ON public.council_activity_log FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Seed all 12 councils
INSERT INTO public.councils (id, name, mission, budget_eur_monthly, generator_model, validator_model, producer_model) VALUES
  ('education', 'Education Council', 'Maximale Bestehensquote bei minimalem Lernfrust', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('ai-tutor', 'AI Tutor Council', 'Der Tutor wird besser als jeder menschliche Nachhilfelehrer', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('exam', 'Exam Council', 'Prüfung realistisch simulieren – keine Überraschungen', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('marketing', 'Marketing & Sales Council', 'Skalierbarer Umsatz mit Budgetdisziplin', 100, 'openai/gpt-5.2', 'claude-opus-4.6', 'deepseek-chat'),
  ('product', 'Product Council', 'Produkte die sich verkaufen – nicht erklärt werden müssen', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('ui-ux', 'UI-UX Guardian Council', 'Lernen muss sich leicht, klar und motivierend anfühlen', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('tech', 'Tech & Platform Council', 'Zero Downtime, Zero Data Leak, Zero Chaos', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('legal', 'Legal & Compliance Council', 'Maximale Rechtssicherheit bei minimaler Reibung', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('finance', 'Finance & Pricing Council', 'Höchster LTV bei fairen Preisen', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('partner', 'Partner & Affiliate Council', 'Reichweite ohne Fixkosten', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('analytics', 'Analytics & Optimization Council', 'Keine Entscheidung ohne Daten', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL),
  ('operations', 'Operations Council', 'Alles läuft – auch wenn du nichts tust', 0, 'openai/gpt-5.2', 'claude-opus-4.6', NULL);

-- Seed default KPIs
INSERT INTO public.council_kpis (council_id, kpi_name, target_value, unit) VALUES
  ('education', 'Lesson Completion Rate', 85, '%'),
  ('education', 'MiniCheck Pass Rate', 80, '%'),
  ('ai-tutor', 'Tutor Feedback Score', 4.5, 'score'),
  ('ai-tutor', 'Korrekturquote', 5, '%'),
  ('exam', 'Bestehensquote Simulation', 75, '%'),
  ('marketing', 'CAC', 10, '€'),
  ('marketing', 'Conversion Rate', 4, '%'),
  ('marketing', 'Monats-Umsatz', 500, '€'),
  ('ui-ux', 'UX Friction Score', 20, 'score'),
  ('ui-ux', 'Mobile Completion Rate', 75, '%'),
  ('tech', 'Uptime', 99.5, '%'),
  ('tech', 'Error Rate', 1, '%'),
  ('finance', 'LTV', 29, '€'),
  ('finance', 'Churn Rate', 5, '%'),
  ('partner', 'Umsatz pro Partner', 50, '€');

-- Seed default kill switches
INSERT INTO public.council_kill_switches (council_id, rule_name, kpi_name, operator, threshold, action) VALUES
  ('marketing', 'Budget Overrun', 'budget_spent_eur', '>', 100, 'pause'),
  ('marketing', 'Low Conversion Kill', 'Conversion Rate', '<', 1, 'pause'),
  ('ui-ux', 'Completion Drop', 'Lesson Completion Rate', '<', 60, 'alert'),
  ('ui-ux', 'High Friction', 'UX Friction Score', '>', 50, 'alert'),
  ('tech', 'Error Spike', 'Error Rate', '>', 5, 'alert'),
  ('education', 'MiniCheck Failure', 'MiniCheck Pass Rate', '<', 50, 'alert');

-- Timestamp trigger
CREATE TRIGGER update_councils_updated_at BEFORE UPDATE ON public.councils FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_council_kpis_council ON public.council_kpis(council_id);
CREATE INDEX idx_council_decisions_council ON public.council_decisions(council_id);
CREATE INDEX idx_council_escalations_source ON public.council_escalations(source_council_id);
CREATE INDEX idx_council_activity_council ON public.council_activity_log(council_id);
CREATE INDEX idx_council_kill_switches_council ON public.council_kill_switches(council_id);
