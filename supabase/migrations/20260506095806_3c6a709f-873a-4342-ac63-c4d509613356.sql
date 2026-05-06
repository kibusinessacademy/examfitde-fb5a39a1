
CREATE OR REPLACE FUNCTION public.admin_scaffold_persona_overlays(p_dry_run boolean DEFAULT false)
RETURNS TABLE(action text, package_id uuid, persona text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record;
  v_persona public.product_persona;
  v_personas public.product_persona[] := ARRAY['azubi','betrieb','institution']::public.product_persona[];
  v_title text; v_price_str text;
  v_hero_h text; v_hero_s text; v_cta text;
  v_usps text[]; v_pains text[]; v_trust text[];
  v_seo_t text; v_seo_d text; v_kicker text;
  v_year int := EXTRACT(YEAR FROM now())::int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT (current_setting('role', true) = 'service_role')
     AND auth.role() <> 'service_role' THEN
    -- allow service_role for ops scripts; else require admin
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'admin role required';
    END IF;
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.package_key,
           COALESCE(pr.amount_cents/100.0, 49.0) AS price_eur
    FROM public.course_packages cp
    LEFT JOIN LATERAL (
      SELECT pp.amount_cents
      FROM public.products p
      JOIN public.product_prices pp ON pp.product_id = p.id AND pp.active = true
      WHERE p.curriculum_id = cp.curriculum_id AND p.status='active'
      ORDER BY pp.created_at DESC LIMIT 1
    ) pr ON true
    WHERE cp.status = 'published'
  LOOP
    v_title := v_pkg.title;
    v_price_str := replace(to_char(v_pkg.price_eur, 'FM999990D00'), '.', ',');

    FOREACH v_persona IN ARRAY v_personas LOOP
      IF v_persona = 'azubi' THEN
        v_kicker := 'Für Azubis';
        v_hero_h := v_title || ' bestehen – ohne Stress, ohne Lücken';
        v_hero_s := 'Trainiere echte Prüfungsfragen, typische Fallen und mündliche Situationen – für ' || v_price_str || ' € einmalig.';
        v_cta := 'Jetzt Prüfungstraining starten';
        v_usps := ARRAY['Prüfungsfragen aus echten Vorjahren','KI-Coach erklärt Fehler sofort','Mündliche Simulation inklusive','Lernfortschritt jederzeit sichtbar'];
        v_pains := ARRAY['Angst, in der Prüfung zu blockieren','Unsicher, was wirklich drankommt','Keine Zeit für Bücher wälzen'];
        v_trust := ARRAY['Geld-zurück bei Nichtbestehen','12 Monate Zugriff','Made in Germany'];
        v_seo_t := v_title || ' Ausbildung – Prüfung bestehen ' || v_year::text;
        v_seo_d := v_title || ' Abschlussprüfung sicher bestehen: KI-Coach, Simulation, Fragenpool. Einmalig ' || v_price_str || ' €.';
      ELSIF v_persona = 'betrieb' THEN
        v_kicker := 'Für Ausbildungsbetriebe';
        v_hero_h := v_title || ' – Azubis sicher zur Prüfung führen';
        v_hero_s := 'Strukturiertes Training mit Fortschrittstransparenz für Ausbilder:innen – Lizenzen ab ' || v_price_str || ' € pro Azubi.';
        v_cta := 'Jetzt Lizenzen anfragen';
        v_usps := ARRAY['Mehrere Azubis zentral verwalten','Fortschritt & Schwächen pro Azubi','DSGVO-konforme Lernanalytik','Sammelrechnung & Steuerbeleg'];
        v_pains := ARRAY['Hohe Durchfallquote belastet Betrieb','Keine Übersicht über Lernstand','Aufwand für individuelle Prüfungsvorbereitung'];
        v_trust := ARRAY['Über 50 IHK-Berufe','Datenresidenz EU','Persönlicher Ansprechpartner'];
        v_seo_t := v_title || ' Ausbildungsbetrieb – Prüfungserfolg sichern (' || v_year::text || ')';
        v_seo_d := v_title || ' für Ausbildungsbetriebe: Azubis gezielt auf die Prüfung vorbereiten, Lernstand pro Auszubildendem im Blick.';
      ELSE  -- institution
        v_kicker := 'Für Bildungsträger';
        v_hero_h := v_title || ' für Bildungsträger – Prüfungsvorbereitung skalieren';
        v_hero_s := 'Strukturiertes Training für Umschüler:innen und Quereinsteiger – ' || v_price_str || ' € pro Lizenz, 12 Monate Zugriff.';
        v_cta := 'Jetzt Lizenzen anfragen';
        v_usps := ARRAY['Mehrere Teilnehmende zentral verwalten','Wiederholte Schwachstellen-Analyse','Mündliche Prüfungssimulation','KI-Tutor 24/7 verfügbar'];
        v_pains := ARRAY['Heterogene Vorkenntnisse','Knappe Personalressourcen','Förderfähigkeit nachweisen'];
        v_trust := ARRAY['Förderfähig (AVGS möglich)','Datenresidenz EU','Persönlicher Ansprechpartner'];
        v_seo_t := v_title || ' Bildungsträger – Prüfungsvorbereitung ' || v_year::text;
        v_seo_d := v_title || ' für Bildungsträger: zentrale Verwaltung, KI-Coach, Mündlich-Simulation. ' || v_price_str || ' € pro Lizenz.';
      END IF;

      IF p_dry_run THEN
        RETURN QUERY SELECT 'would_insert'::text, v_pkg.id, v_persona::text;
      ELSE
        INSERT INTO public.product_persona_overlays(
          package_id, persona_type, kicker, hero_headline, hero_subheadline,
          cta_label, usps, pains, trust_signals, seo_title, seo_description, active
        ) VALUES (
          v_pkg.id, v_persona, v_kicker, v_hero_h, v_hero_s,
          v_cta, v_usps, v_pains, v_trust, v_seo_t, v_seo_d, true
        )
        ON CONFLICT (package_id, persona_type) DO NOTHING;

        IF FOUND THEN
          RETURN QUERY SELECT 'inserted'::text, v_pkg.id, v_persona::text;
        ELSE
          RETURN QUERY SELECT 'skipped_existing'::text, v_pkg.id, v_persona::text;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END
$function$;
