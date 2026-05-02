-- ============================================================================
-- Path D: product_persona_overlays (Persona-Overlay SSOT, keine Truth-Daten)
-- ============================================================================
-- Ersetzt deprecated product_landing_profiles (cert-basiert, kein Reader).
-- Enthält NUR persona-spezifische Copy/CTA/SEO-Wording.
-- Truth bleibt in v_product_page_published_ssot.

-- 1. Deprecate alte Tabelle
COMMENT ON TABLE public.product_landing_profiles IS
'DEPRECATED 2026-05-02: Ersetzt durch product_persona_overlays. Kein Frontend-Reader. Nicht mehr beschreiben. Drop nach 60-Tage Cooldown.';

-- 2. Persona enum
DO $$ BEGIN
  CREATE TYPE public.product_persona AS ENUM ('azubi','betrieb','umschulung');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Overlay-Tabelle
CREATE TABLE IF NOT EXISTS public.product_persona_overlays (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  persona_type    public.product_persona NOT NULL,

  -- Persona-Copy (nur Wording, keine Truth)
  hero_kicker     text,
  hero_headline   text NOT NULL,
  hero_subline    text NOT NULL,
  primary_cta     text NOT NULL,
  secondary_cta   text,
  usp_items       text[] NOT NULL DEFAULT '{}',
  pain_points     text[] NOT NULL DEFAULT '{}',
  trust_items     text[] NOT NULL DEFAULT '{}',

  -- Persona-SEO (override v_product_page_ssot bei Anzeige)
  seo_title       text,
  seo_description text,

  active          boolean NOT NULL DEFAULT true,
  source          text NOT NULL DEFAULT 'scaffold',  -- scaffold | manual | generator
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_persona_overlay_pkg_persona UNIQUE (package_id, persona_type)
);

CREATE INDEX IF NOT EXISTS idx_persona_overlays_package ON public.product_persona_overlays(package_id);
CREATE INDEX IF NOT EXISTS idx_persona_overlays_active  ON public.product_persona_overlays(active) WHERE active = true;

-- 4. updated_at trigger
CREATE TRIGGER trg_persona_overlays_updated_at
BEFORE UPDATE ON public.product_persona_overlays
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. RLS: public read (active=true), nur admin write
ALTER TABLE public.product_persona_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "persona_overlays_public_read_active"
ON public.product_persona_overlays FOR SELECT
TO anon, authenticated
USING (active = true);

CREATE POLICY "persona_overlays_admin_write"
ON public.product_persona_overlays FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Bulk-Scaffold RPC: 1 Overlay pro (published package, persona) — idempotent
CREATE OR REPLACE FUNCTION public.admin_scaffold_persona_overlays(
  p_dry_run boolean DEFAULT false
) RETURNS TABLE(action text, package_id uuid, persona text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_persona public.product_persona;
  v_personas public.product_persona[] := ARRAY['azubi','betrieb','umschulung']::public.product_persona[];
  v_title text;
  v_price_str text;
  v_hero_h text; v_hero_s text; v_cta text;
  v_usps text[]; v_pains text[]; v_trust text[];
  v_seo_t text; v_seo_d text;
  v_kicker text;
  v_year int := EXTRACT(YEAR FROM now())::int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.package_key,
           COALESCE(pr.amount_cents/100.0, 49.0) AS price_eur
    FROM course_packages cp
    LEFT JOIN LATERAL (
      SELECT pri.amount_cents
      FROM products p
      JOIN prices pri ON pri.product_id = p.id AND pri.active = true
      WHERE p.curriculum_id = cp.curriculum_id AND p.status='active'
      ORDER BY pri.created_at DESC LIMIT 1
    ) pr ON true
    WHERE cp.status = 'published'
  LOOP
    v_title := v_pkg.title;
    v_price_str := replace(to_char(v_pkg.price_eur, 'FM999990D00'), '.', ',');

    FOREACH v_persona IN ARRAY v_personas LOOP
      -- Persona-spezifische Templates
      IF v_persona = 'azubi' THEN
        v_kicker := 'Für Azubis';
        v_hero_h := v_title || ' bestehen – ohne Stress, ohne Lücken';
        v_hero_s := 'Trainiere echte Prüfungsfragen, typische Fallen und mündliche Situationen – für ' || v_price_str || ' € einmalig.';
        v_cta := 'Jetzt Prüfungstraining starten';
        v_usps := ARRAY[
          'Prüfungsfragen aus echten Vorjahren',
          'KI-Coach erklärt Fehler sofort',
          'Mündliche Simulation inklusive',
          'Lernfortschritt jederzeit sichtbar'
        ];
        v_pains := ARRAY[
          'Angst, in der Prüfung zu blockieren',
          'Unsicher, was wirklich drankommt',
          'Keine Zeit für Bücher wälzen'
        ];
        v_trust := ARRAY['Geld-zurück bei Nichtbestehen','12 Monate Zugriff','Made in Germany'];
        v_seo_t := v_title || ' Ausbildung – Prüfung bestehen ' || v_year::text;
        v_seo_d := v_title || ' Abschlussprüfung sicher bestehen: KI-Coach, Simulation, Fragenpool. Einmalig ' || v_price_str || ' €.';
      ELSIF v_persona = 'betrieb' THEN
        v_kicker := 'Für Ausbildungsbetriebe';
        v_hero_h := v_title || ' – Azubis sicher zur Prüfung führen';
        v_hero_s := 'Strukturiertes Training mit Fortschrittstransparenz für Ausbilder:innen – Lizenzen ab ' || v_price_str || ' € pro Azubi.';
        v_cta := 'Jetzt Lizenzen anfragen';
        v_usps := ARRAY[
          'Mehrere Azubis zentral verwalten',
          'Fortschritt & Schwächen pro Azubi',
          'DSGVO-konforme Lernanalytik',
          'Sammelrechnung & Steuerbeleg'
        ];
        v_pains := ARRAY[
          'Hohe Durchfallquote belastet Betrieb',
          'Keine Übersicht über Lernstand',
          'Aufwand für individuelle Prüfungsvorbereitung'
        ];
        v_trust := ARRAY['Über 50 IHK-Berufe','Datenresidenz EU','Persönlicher Ansprechpartner'];
        v_seo_t := v_title || ' Ausbildungsbetrieb – Prüfungserfolg sichern (' || v_year::text || ')';
        v_seo_d := v_title || ' für Ausbildungsbetriebe: Azubis gezielt auf die Prüfung vorbereiten, Lernstand pro Auszubildendem im Blick.';
      ELSE  -- umschulung
        v_kicker := 'Für Umschüler:innen';
        v_hero_h := v_title || ' Umschulung – Prüfung sicher bestehen';
        v_hero_s := 'Strukturiertes Training für Quereinsteiger und Umschulung – ' || v_price_str || ' € einmalig, 12 Monate Zugriff.';
        v_cta := 'Jetzt Umschulungs-Training starten';
        v_usps := ARRAY[
          'Aufbau ohne Vorwissen möglich',
          'Wiederholte Schwachstellen-Analyse',
          'Mündliche Prüfungssimulation',
          'KI-Tutor 24/7 verfügbar'
        ];
        v_pains := ARRAY[
          'Fachfremder Hintergrund',
          'Lange Lernpause hinter sich',
          'Wenig Zeit neben Familie/Job'
        ];
        v_trust := ARRAY['Förderfähig (AVGS möglich)','Geld-zurück bei Nichtbestehen','Mobil lernen'];
        v_seo_t := v_title || ' Umschulung – Prüfungsvorbereitung ' || v_year::text;
        v_seo_d := v_title || ' für Umschüler:innen: Aufbau ohne Vorwissen, KI-Tutor, mündliche Simulation. Einmalig ' || v_price_str || ' €.';
      END IF;

      IF p_dry_run THEN
        RETURN QUERY SELECT 'would_insert'::text, v_pkg.id, v_persona::text;
      ELSE
        INSERT INTO public.product_persona_overlays(
          package_id, persona_type, hero_kicker, hero_headline, hero_subline,
          primary_cta, secondary_cta, usp_items, pain_points, trust_items,
          seo_title, seo_description, source, active
        ) VALUES (
          v_pkg.id, v_persona, v_kicker, v_hero_h, v_hero_s,
          v_cta, 'Kostenlosen Prüfungsreife-Check starten', v_usps, v_pains, v_trust,
          v_seo_t, v_seo_d, 'scaffold', true
        )
        ON CONFLICT (package_id, persona_type) DO NOTHING;

        IF FOUND THEN
          RETURN QUERY SELECT 'inserted'::text, v_pkg.id, v_persona::text;
        ELSE
          RETURN QUERY SELECT 'skipped_exists'::text, v_pkg.id, v_persona::text;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_scaffold_persona_overlays(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_scaffold_persona_overlays(boolean) TO authenticated;

-- 7. v_data_holes_ssot um L8 erweitern (NO_PERSONA_OVERLAY)
CREATE OR REPLACE VIEW public.v_data_holes_ssot AS
WITH l1 AS (
  SELECT 'L1_jobs_pending_no_job_name'::text AS hole_key, 'HIGH'::text AS severity, COUNT(*)::int AS n,
         'Identity-Contract-Drift: Producer schreibt job_type ohne job_name'::text AS detail
  FROM job_queue WHERE status='pending' AND (job_name IS NULL OR job_name='')
), l2 AS (
  SELECT 'L2_steps_queued_no_job', 'HIGH', COUNT(*)::int,
         'Phantom-Steps in queued/planning/building Paketen ohne aktiven Job'
  FROM package_steps ps JOIN course_packages cp ON cp.id=ps.package_id
  WHERE ps.status='queued'::step_status AND cp.status = ANY(ARRAY['queued','planning','building','blocked'])
    AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=ps.package_id
                    AND jq.job_type='package_'||ps.step_key AND jq.status = ANY(ARRAY['pending','processing','queued']))
), l3 AS (
  SELECT 'L3_orders_paid_no_grant', 'CRITICAL', COUNT(*)::int,
         'Echte paid Orders (non-test) ohne aktiven learner_course_grant'
  FROM orders o WHERE o.status='paid' AND o.created_at > now()-interval '30 days'
    AND NOT is_e2e_smoke_user(COALESCE(o.learner_user_id, o.buyer_user_id))
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    JOIN learner_course_grants lcg ON lcg.user_id=COALESCE(o.learner_user_id,o.buyer_user_id)
                    AND lcg.curriculum_id=p.curriculum_id WHERE oi.order_id=o.id AND lcg.status='active')
), l4 AS (
  SELECT 'L4_jobs_processing_stale_2h', 'MEDIUM', COUNT(*)::int,
         'Processing-Jobs >2h (Reap-Loop-Guard sollte greifen)'
  FROM job_queue WHERE status='processing' AND started_at < now()-interval '2 hours'
), l5 AS (
  SELECT 'L5_active_products_no_curriculum', 'MEDIUM', COUNT(*)::int,
         'Aktive Products ohne curriculum_id - Käufe können keine Grants auslösen'
  FROM products WHERE curriculum_id IS NULL AND status='active'
), l6 AS (
  SELECT 'L6_products_curriculum_orphan_fk', 'MEDIUM', COUNT(*)::int,
         'Products mit curriculum_id, aber Curriculum existiert nicht (FK-Loch)'
  FROM products p WHERE p.curriculum_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM curricula c WHERE c.id=p.curriculum_id)
), l7 AS (
  SELECT 'L7_e2e_test_orders_30d', 'INFO', COUNT(*)::int,
         'E2E-Smoke-Test Orders der letzten 30 Tage (kein echtes Loch)'
  FROM orders o WHERE o.status='paid' AND o.created_at > now()-interval '30 days'
    AND is_e2e_smoke_user(COALESCE(o.learner_user_id, o.buyer_user_id))
), l8 AS (
  SELECT 'L8_published_pkg_no_persona_overlay', 'LOW', COUNT(*)::int,
         'Published packages ohne mind. 1 active persona-overlay (Conversion-Personalisierung fehlt)'
  FROM course_packages cp
  WHERE cp.status='published'
    AND NOT EXISTS (SELECT 1 FROM product_persona_overlays o WHERE o.package_id=cp.id AND o.active=true)
)
SELECT * FROM l1
UNION ALL SELECT * FROM l2 l2(hole_key,severity,n,detail)
UNION ALL SELECT * FROM l3 l3(hole_key,severity,n,detail)
UNION ALL SELECT * FROM l4 l4(hole_key,severity,n,detail)
UNION ALL SELECT * FROM l5 l5(hole_key,severity,n,detail)
UNION ALL SELECT * FROM l6 l6(hole_key,severity,n,detail)
UNION ALL SELECT * FROM l7 l7(hole_key,severity,n,detail)
UNION ALL SELECT * FROM l8 l8(hole_key,severity,n,detail);

-- 8. Helper view: Pre-Audit Coverage
CREATE OR REPLACE VIEW public.v_persona_overlay_coverage AS
SELECT
  cp.id AS package_id,
  cp.package_key,
  cp.title,
  COUNT(o.id) FILTER (WHERE o.active) AS active_overlays,
  ARRAY_AGG(o.persona_type::text ORDER BY o.persona_type) FILTER (WHERE o.active) AS personas
FROM course_packages cp
LEFT JOIN product_persona_overlays o ON o.package_id = cp.id
WHERE cp.status='published'
GROUP BY cp.id, cp.package_key, cp.title;

REVOKE ALL ON public.v_persona_overlay_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_persona_overlay_coverage TO service_role;