
-- Add persona_type to seo_content_pages
ALTER TABLE public.seo_content_pages
ADD COLUMN persona_type text NOT NULL DEFAULT 'azubi';

CREATE INDEX idx_seo_content_pages_persona ON public.seo_content_pages(persona_type);

-- Replace seed function to create persona-specific pages
CREATE OR REPLACE FUNCTION public.seed_seo_pages_for_package(
  p_package_id uuid,
  p_curriculum_id uuid,
  p_base_slug text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_persona record;
  v_audiences text[];
BEGIN
  -- Persona definitions: type, page_type, target_audience, slug_prefix
  FOR v_persona IN
    SELECT * FROM (VALUES
      ('azubi',     'landing_azubis',        'Auszubildende',                    'pruefungstraining-azubis'),
      ('sachkunde', 'landing_sachkunde',      'Sachkundeprüfung-Teilnehmer',     'pruefungstraining-sachkunde'),
      ('fachwirt',  'landing_fachwirt',       'Fachwirt-/Fortbildungsteilnehmer', 'pruefungstraining-fachwirt'),
      ('studium',   'landing_studium',        'Studierende',                      'pruefungstraining-studium'),
      ('azubi',     'landing_betriebe',       'Ausbildungsbetriebe',              'betriebe'),
      ('azubi',     'faq',                    'allgemein',                        'faq')
    ) AS t(persona_type, page_type, target_audience, slug_prefix)
  LOOP
    INSERT INTO seo_content_pages (
      package_id, curriculum_id, page_type, target_audience,
      slug, title, status, persona_type
    )
    VALUES (
      p_package_id, p_curriculum_id, v_persona.page_type, v_persona.target_audience,
      v_persona.slug_prefix || '/' || p_base_slug,
      'SEO: ' || v_persona.page_type || ' – ' || p_base_slug,
      'draft',
      v_persona.persona_type
    )
    ON CONFLICT DO NOTHING;
    
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
