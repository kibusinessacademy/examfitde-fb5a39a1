
ALTER TABLE public.conversation_os_scenarios
  ADD COLUMN IF NOT EXISTS vertical_module TEXT;

COMMENT ON COLUMN public.conversation_os_scenarios.vertical_module IS
  'Vertical product module key. Same engine, different productized funnel.';

UPDATE public.conversation_os_scenarios SET vertical_module = 'hr_interview_os'
  WHERE scenario_key IN ('hr_job_interview_specialist','hr_salary_negotiation','hr_termination_humane');
UPDATE public.conversation_os_scenarios SET vertical_module = 'leadership_os'
  WHERE scenario_key IN ('hr_feedback_critical','hr_conflict_mediation','hr_onboarding_kickoff','hr_one_on_one','leadership_coaching_grow');
UPDATE public.conversation_os_scenarios SET vertical_module = 'med_talk_os'
  WHERE scenario_key = 'medical_patient_briefing';
UPDATE public.conversation_os_scenarios SET vertical_module = 'sales_conversation_os'
  WHERE scenario_key = 'sales_discovery_b2b';
UPDATE public.conversation_os_scenarios SET vertical_module = 'support_escalation_os'
  WHERE scenario_key = 'service_difficult_customer';
UPDATE public.conversation_os_scenarios SET vertical_module = 'compliance_conversation_os'
  WHERE scenario_key = 'compliance_short_briefing';

CREATE INDEX IF NOT EXISTS idx_conv_os_scenarios_vertical
  ON public.conversation_os_scenarios(vertical_module)
  WHERE vertical_module IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conversation_os_vertical_modules (
  module_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  buyer_persona TEXT NOT NULL,
  primary_outcome TEXT NOT NULL,
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  trains JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_slug TEXT NOT NULL,
  hero_eyebrow TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.conversation_os_vertical_modules TO anon, authenticated;
GRANT ALL ON public.conversation_os_vertical_modules TO service_role;

ALTER TABLE public.conversation_os_vertical_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vertical modules are publicly readable" ON public.conversation_os_vertical_modules;
CREATE POLICY "Vertical modules are publicly readable"
  ON public.conversation_os_vertical_modules FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Service role full access vertical modules" ON public.conversation_os_vertical_modules;
CREATE POLICY "Service role full access vertical modules"
  ON public.conversation_os_vertical_modules FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.conversation_os_vertical_modules
  (module_key, display_name, tagline, buyer_persona, primary_outcome, outcomes, trains, route_slug, hero_eyebrow, sort_order)
VALUES
  ('hr_interview_os','HR InterviewOS','Führen Sie bessere Bewerbungsgespräche.',
   'Recruiter · HR Business Partner · Teamleiter',
   'Bessere Einstellungen, professionellere Interviews',
   '["Höhere Trefferquote bei Einstellungen","Strukturierte Cultural-Fit-Bewertung","Souveräne Gehaltsverhandlungen","Faire Trennungsgespräche"]'::jsonb,
   '["Bewerbungsgespräche mit schwierigen Kandidaten","Gehaltsverhandlungen aus Arbeitgebersicht","Cultural-Fit- und Stress-Interviews","Würdevolle Trennungsgespräche"]'::jsonb,
   'hr-interview','Für Recruiter und Hiring Manager',10),
  ('leadership_os','LeadershipOS','Führen Sie souveräner durch jedes schwierige Gespräch.',
   'Führungskräfte · Teamleiter · Manager',
   'Stärkere Teams, weniger Konflikte, bessere Performance',
   '["Klares Feedback ohne Beziehungsschaden","Konflikte deeskalieren statt eskalieren","Low-Performer-Gespräche professionell führen","Onboardings, die binden"]'::jsonb,
   '["Kritisches Feedback (WWW+B)","Konfliktmediation im Team","1:1 Performance-Gespräche","Coaching mit GROW-Modell","Onboarding-Kickoff 30-60-90"]'::jsonb,
   'leadership','Für Führungskräfte',20),
  ('med_talk_os','MedTalkOS','Schwierige Patientengespräche sicher führen.',
   'Ärzt:innen · Pflegekräfte · Psycholog:innen · Klinikpersonal',
   'Bessere Patientenkommunikation, weniger Eskalation, weniger Belastung',
   '["Schlechte Nachrichten würdevoll überbringen","Angehörige souverän begleiten","Aggression deeskalieren","Compliance + Empathie verbinden"]'::jsonb,
   '["SPIKES Bad-News-Protokoll","Aufklärungsgespräche vor OP","Angehörigengespräche","Eskalative Situationen entschärfen"]'::jsonb,
   'med-talk','Für Medizin & Pflege',30),
  ('sales_conversation_os','SalesConversationOS','Bessere Discovery, höhere Conversion.',
   'Account Executives · Sales · Customer Success',
   'Mehr abgeschlossene Deals, konsistente Sales-Qualität',
   '["Discovery, die echten Pain aufdeckt","Preisverhandlungen souverän führen","Einwände in Commitment verwandeln","Enterprise-Stakeholder navigieren"]'::jsonb,
   '["B2B Discovery Calls mit Pain-Funnel","Preisverhandlung & Rabatt-Forderungen","Einwandbehandlung","Enterprise Stakeholder Management"]'::jsonb,
   'sales-conversation','Für Vertrieb & Customer Success',40),
  ('support_escalation_os','SupportEscalationOS','Deeskalieren, bevor es teuer wird.',
   'Customer Support · Service · Beschwerde-Management',
   'Weniger Eskalationen, höhere Kundenzufriedenheit',
   '["Schwierige Kunden ruhig führen","Beschwerden in Bindung verwandeln","Eskalationspfade sicher abarbeiten","Konsistente Service-Qualität"]'::jsonb,
   '["Eskalations-Telefonate mit schwierigen Kunden","Beschwerdemanagement","Reklamationsgespräche","Konflikt-Deeskalation am Telefon"]'::jsonb,
   'support-escalation','Für Customer Support',50),
  ('compliance_conversation_os','ComplianceConversationOS','Audit-sichere Gespräche, jedes Mal.',
   'Banken · Versicherungen · Compliance · Datenschutz',
   'Audit-Sicherheit, regulatorische Konsistenz',
   '["DSGVO-konforme Kundengespräche","Audit-Vorbereitung mit der Aufsicht","Konsistente Compliance-Briefings","Beweisbare Schulungsstände"]'::jsonb,
   '["DSGVO-Kurzbriefings für Mitarbeitende","Aufsichtsgespräche vorbereiten","Audit-Interviews durchspielen","Regulatorische Eskalationen"]'::jsonb,
   'compliance-conversation','Für Compliance & Aufsicht',60)
ON CONFLICT (module_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  tagline = EXCLUDED.tagline,
  buyer_persona = EXCLUDED.buyer_persona,
  primary_outcome = EXCLUDED.primary_outcome,
  outcomes = EXCLUDED.outcomes,
  trains = EXCLUDED.trains,
  route_slug = EXCLUDED.route_slug,
  hero_eyebrow = EXCLUDED.hero_eyebrow,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.public_list_conversation_os_modules()
RETURNS TABLE (
  module_key TEXT, display_name TEXT, tagline TEXT, buyer_persona TEXT,
  primary_outcome TEXT, outcomes JSONB, trains JSONB, route_slug TEXT,
  hero_eyebrow TEXT, scenario_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.module_key, m.display_name, m.tagline, m.buyer_persona,
    m.primary_outcome, m.outcomes, m.trains, m.route_slug, m.hero_eyebrow,
    COALESCE(COUNT(s.id), 0)::BIGINT
  FROM public.conversation_os_vertical_modules m
  LEFT JOIN public.conversation_os_scenarios s
    ON s.vertical_module = m.module_key AND s.status = 'published'
  WHERE m.is_active = true
  GROUP BY m.module_key, m.display_name, m.tagline, m.buyer_persona,
           m.primary_outcome, m.outcomes, m.trains, m.route_slug,
           m.hero_eyebrow, m.sort_order
  ORDER BY m.sort_order ASC;
$$;

GRANT EXECUTE ON FUNCTION public.public_list_conversation_os_modules() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_get_conversation_os_module(_route_slug TEXT)
RETURNS TABLE (
  module_key TEXT, display_name TEXT, tagline TEXT, buyer_persona TEXT,
  primary_outcome TEXT, outcomes JSONB, trains JSONB, route_slug TEXT,
  hero_eyebrow TEXT, scenarios JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.module_key, m.display_name, m.tagline, m.buyer_persona,
    m.primary_outcome, m.outcomes, m.trains, m.route_slug, m.hero_eyebrow,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'scenario_key', s.scenario_key,
        'title', s.title,
        'short_pitch', s.short_pitch,
        'domain', s.domain,
        'difficulty', s.difficulty,
        'time_limit_minutes', s.time_limit_minutes,
        'persona', s.persona
      ) ORDER BY s.difficulty, s.title)
      FROM public.conversation_os_scenarios s
      WHERE s.vertical_module = m.module_key AND s.status = 'published'),
      '[]'::jsonb
    )
  FROM public.conversation_os_vertical_modules m
  WHERE m.route_slug = _route_slug AND m.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.public_get_conversation_os_module(TEXT) TO anon, authenticated;
