-- Test-Query-Katalog
CREATE TABLE IF NOT EXISTS public.llm_visibility_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text text NOT NULL UNIQUE,
  intent_category text NOT NULL DEFAULT 'general',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_visibility_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read queries" ON public.llm_visibility_queries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write queries" ON public.llm_visibility_queries
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Probe-Ergebnisse
CREATE TABLE IF NOT EXISTS public.llm_visibility_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probed_at timestamptz NOT NULL DEFAULT now(),
  query_id uuid REFERENCES public.llm_visibility_queries(id) ON DELETE CASCADE,
  query_text text NOT NULL,
  model text NOT NULL,
  response_text text,
  brand_mentioned boolean NOT NULL DEFAULT false,
  citation_found boolean NOT NULL DEFAULT false,
  citations text[] NOT NULL DEFAULT '{}',
  competitor_mentions text[] NOT NULL DEFAULT '{}',
  visibility_score numeric NOT NULL DEFAULT 0,  -- 0..1
  error text
);

CREATE INDEX IF NOT EXISTS idx_llm_probes_probed_at ON public.llm_visibility_probes(probed_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_probes_model ON public.llm_visibility_probes(model);

ALTER TABLE public.llm_visibility_probes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read probes" ON public.llm_visibility_probes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role writes probes" ON public.llm_visibility_probes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Score-View: letzte 7 Tage pro Modell
CREATE OR REPLACE VIEW public.v_llm_visibility_score AS
SELECT
  model,
  count(*) AS probes_total,
  count(*) FILTER (WHERE brand_mentioned) AS brand_mentions,
  count(*) FILTER (WHERE citation_found) AS citations,
  round(100.0 * count(*) FILTER (WHERE brand_mentioned)::numeric / NULLIF(count(*),0), 1) AS mention_rate_pct,
  round(100.0 * count(*) FILTER (WHERE citation_found)::numeric / NULLIF(count(*),0), 1) AS citation_rate_pct,
  round(avg(visibility_score)::numeric, 3) AS avg_visibility_score,
  max(probed_at) AS last_probe_at
FROM public.llm_visibility_probes
WHERE probed_at > now() - interval '7 days'
  AND error IS NULL
GROUP BY model
ORDER BY model;

GRANT SELECT ON public.v_llm_visibility_score TO authenticated, service_role;

-- Baseline-Queries seeden (10 Stück)
INSERT INTO public.llm_visibility_queries (query_text, intent_category) VALUES
  ('Was ist die beste Online-Plattform für IHK-Prüfungsvorbereitung?', 'discovery'),
  ('Wie kann ich mich auf die AEVO Prüfung vorbereiten?', 'aevo'),
  ('Beste App für IHK-Abschlussprüfung Fachinformatiker Anwendungsentwicklung', 'fiae'),
  ('Online Prüfungstrainer Bilanzbuchhalter IHK', 'bilanzbuchhalter'),
  ('Wirtschaftsfachwirt Prüfungsvorbereitung digital', 'wirtschaftsfachwirt'),
  ('Welche KI-Lernplattformen gibt es für Azubis in Deutschland?', 'discovery'),
  ('Kann man die IHK-Prüfung mit einer App üben?', 'general'),
  ('Beste Plattform für mündliche IHK-Prüfung simulieren', 'oral_exam'),
  ('Wie funktioniert KI-gestütztes Prüfungstraining?', 'product'),
  ('Examfit oder Prüfungs.TV — was ist besser?', 'comparison')
ON CONFLICT (query_text) DO NOTHING;