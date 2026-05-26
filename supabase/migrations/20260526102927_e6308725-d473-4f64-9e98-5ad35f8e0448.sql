-- Cut 6.1 Migration B: HR-Demo Painpoint Mapping

CREATE TABLE IF NOT EXISTS public.hr_demo_painpoint_map (
  painpoint_key text PRIMARY KEY,
  painpoint_label text NOT NULL,
  painpoint_description text,
  search_terms text[] NOT NULL DEFAULT '{}',
  target_track text,
  weight int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_demo_painpoint_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "painpoint_map_public_read"
  ON public.hr_demo_painpoint_map
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

CREATE POLICY "painpoint_map_admin_write"
  ON public.hr_demo_painpoint_map
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed 6 HR painpoints
INSERT INTO public.hr_demo_painpoint_map (painpoint_key, painpoint_label, painpoint_description, search_terms, target_track, weight) VALUES
  ('kuendigungsgespraech',  'Schwierige Trennungsgespräche', 'Kündigungen rechtssicher und professionell durchführen', ARRAY['kündigung','personal','arbeitsrecht','gespräch','führung'], 'EXAM_FIRST', 100),
  ('onboarding',            'Onboarding & Einarbeitung',     'Neue Mitarbeiter schnell produktiv machen',           ARRAY['onboarding','einarbeitung','ausbildung','personal'], 'AUSBILDUNG_VOLL', 100),
  ('compliance_schulung',   'Compliance-Schulungen',         'Pflichtschulungen nachweisbar durchführen',           ARRAY['compliance','schulung','datenschutz','arbeitsschutz','recht'], 'EXAM_FIRST', 100),
  ('mitarbeiterentwicklung','Mitarbeiterentwicklung',        'Skills aufbauen und Karrierepfade strukturieren',     ARRAY['entwicklung','weiterbildung','kompetenz','fachwirt','aufstieg'], 'AUSBILDUNG_VOLL', 100),
  ('konflikte',             'Konfliktgespräche & Eskalation','Konflikte im Team frühzeitig deeskalieren',           ARRAY['konflikt','kommunikation','mediation','führung','gespräch'], 'EXAM_FIRST_PLUS', 100),
  ('ausbildung_ihk',        'IHK-Ausbildung im Betrieb',     'Azubis erfolgreich zur Prüfung führen',               ARRAY['ausbilder','aevo','ihk','prüfung','azubi'], 'AUSBILDUNG_VOLL', 100)
ON CONFLICT (painpoint_key) DO UPDATE SET
  painpoint_label = EXCLUDED.painpoint_label,
  painpoint_description = EXCLUDED.painpoint_description,
  search_terms = EXCLUDED.search_terms,
  target_track = EXCLUDED.target_track,
  updated_at = now();

-- Match RPC: painpoint -> top N published packages (anon-callable)
CREATE OR REPLACE FUNCTION public.public_match_packages_for_painpoint(
  _painpoint_key text,
  _limit int DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terms text[];
  v_track text;
  v_label text;
  v_result jsonb;
BEGIN
  IF _limit IS NULL OR _limit < 1 OR _limit > 5 THEN
    _limit := 3;
  END IF;

  SELECT search_terms, target_track, painpoint_label
  INTO v_terms, v_track, v_label
  FROM public.hr_demo_painpoint_map
  WHERE painpoint_key = _painpoint_key AND active = true;

  IF v_terms IS NULL THEN
    RETURN jsonb_build_object('error', 'unknown_painpoint', 'painpoint_key', _painpoint_key);
  END IF;

  WITH ranked AS (
    SELECT
      cp.id          AS package_id,
      cp.title       AS package_title,
      cp.package_key,
      cp.track::text AS track,
      cur.title      AS curriculum_title,
      (
        -- match score: term hits in title/curriculum + track bonus
        (SELECT COUNT(*) FROM unnest(v_terms) t
         WHERE cp.title ILIKE '%'||t||'%' OR cur.title ILIKE '%'||t||'%')::int * 10
        + CASE WHEN v_track IS NOT NULL AND cp.track::text = v_track THEN 5 ELSE 0 END
      ) AS score
    FROM public.course_packages cp
    LEFT JOIN public.curricula cur ON cur.id = cp.curriculum_id
    WHERE cp.is_published = true
      AND cp.archived = false
  )
  SELECT jsonb_build_object(
    'painpoint_key', _painpoint_key,
    'painpoint_label', v_label,
    'matches', COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package_id,
      'package_title', package_title,
      'package_key', package_key,
      'track', track,
      'curriculum_title', curriculum_title,
      'match_score', score
    ) ORDER BY score DESC) FILTER (WHERE score > 0), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT * FROM ranked WHERE score > 0 ORDER BY score DESC LIMIT _limit
  ) top;

  RETURN COALESCE(v_result, jsonb_build_object('painpoint_key', _painpoint_key, 'matches', '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.public_match_packages_for_painpoint(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_match_packages_for_painpoint(text, int) TO anon, authenticated, service_role;

DO $$
DECLARE v_seeded int;
BEGIN
  SELECT COUNT(*) INTO v_seeded FROM public.hr_demo_painpoint_map WHERE active = true;
  RAISE NOTICE 'Cut 6.1 L2 smoke: % active HR painpoints seeded', v_seeded;
END $$;