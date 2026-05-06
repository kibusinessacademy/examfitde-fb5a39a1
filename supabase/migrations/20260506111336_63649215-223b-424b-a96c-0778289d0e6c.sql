
DROP FUNCTION IF EXISTS public.admin_scaffold_persona_overlays(boolean);

CREATE FUNCTION public.admin_scaffold_persona_overlays(p_dry_run boolean DEFAULT true)
RETURNS TABLE(action text, package_id uuid, persona_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_personas text[] := ARRAY['azubi','betrieb','institution'];
  v_persona text;
  r record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR r IN
    SELECT cp.id AS pkg_id, COALESCE(cp.title, cp.package_key, cp.id::text) AS title
    FROM public.course_packages cp
    WHERE cp.status = 'published'
  LOOP
    FOREACH v_persona IN ARRAY v_personas LOOP
      IF EXISTS (
        SELECT 1 FROM public.product_persona_overlays o
        WHERE o.package_id = r.pkg_id
          AND o.persona_type::text = v_persona
          AND o.active = true
      ) THEN
        action := 'skip_exists'; package_id := r.pkg_id; persona_type := v_persona;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF p_dry_run THEN
        action := 'would_insert'; package_id := r.pkg_id; persona_type := v_persona;
        RETURN NEXT;
      ELSE
        INSERT INTO public.product_persona_overlays (
          package_id, persona_type,
          hero_kicker, hero_headline, hero_subline,
          primary_cta, secondary_cta,
          usp_items, pain_points, trust_items,
          seo_title, seo_description,
          active, source
        ) VALUES (
          r.pkg_id,
          v_persona::public.product_persona,
          CASE v_persona
            WHEN 'azubi' THEN 'Für Auszubildende'
            WHEN 'betrieb' THEN 'Für Ausbildungsbetriebe'
            ELSE 'Für Bildungsinstitutionen'
          END,
          CASE v_persona
            WHEN 'azubi' THEN r.title || ' – Prüfungstraining für Azubis'
            WHEN 'betrieb' THEN r.title || ' – Azubi-Förderung im Betrieb'
            ELSE r.title || ' – Prüfungstraining für Bildungsträger'
          END,
          CASE v_persona
            WHEN 'azubi' THEN 'Bestehe deine Prüfung mit System – realistische Aufgaben, KI-Tutor und persönlicher Lernpfad.'
            WHEN 'betrieb' THEN 'Mache deine Azubis prüfungssicher – ohne deinen Ausbilderalltag zusätzlich zu belasten.'
            ELSE 'Strukturiertes Prüfungstraining für Klassen und Lerngruppen – DSGVO-konform und IHK-orientiert.'
          END,
          CASE v_persona
            WHEN 'azubi' THEN 'Jetzt Pruefungsreife testen'
            WHEN 'betrieb' THEN 'Lizenz fuer Azubis sichern'
            ELSE 'Institutslizenz anfragen'
          END,
          'Mehr erfahren',
          ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
          NULL, NULL,
          true, 'scaffold_v2'
        )
        ON CONFLICT (package_id, persona_type) DO NOTHING;

        action := 'inserted'; package_id := r.pkg_id; persona_type := v_persona;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_scaffold_persona_overlays(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_scaffold_persona_overlays(boolean) TO service_role;
