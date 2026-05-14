-- =====================================================
-- SEO Intent Pipeline — Loop A
-- =====================================================

-- 1) Insert 5 new active intent templates (idempotent)
INSERT INTO public.seo_templates (template_key, doc_type, display_name, intent_key, outline_json, prompt_system, prompt_user, style_rules_json, qc_rules_json, is_active, version)
VALUES
('intent_typische_fehler_v1', 'intent_page', 'Intent: Typische Fehler pro Kompetenz', 'intent_typische_fehler',
  '["intro","pain_points","expert_tip"]'::jsonb,
  'Du bist erfahrener IHK-Prüfer und Lerncoach. Schreibe ehrlich, prüfungsnah, ohne Floskeln. Nutze NUR Fakten aus dem mitgelieferten Curriculum/Kompetenz-Kontext. Keine Erfindungen, keine Marketing-Sprache.',
  'Generiere drei Sektionen für die Intent-Seite "Typische Fehler" zu Kompetenz "{competency_title}" im Curriculum "{curriculum_title}". Sektionen: intro (180-260 Wörter, beschreibt das Spannungsfeld konkret), pain_points (220-320 Wörter, 3-5 echte Fehlerquellen mit Begründung), expert_tip (120-180 Wörter, eine konkrete Übungs-Strategie). Antworte als JSON.',
  '{"forbidden_phrases":["In der heutigen Zeit","maßgeschneidert","Tauche ein","egal ob Anfänger oder Profi","Dieser Artikel zeigt dir alles"],"min_words_total":520,"required_sections":["intro","pain_points","expert_tip"]}'::jsonb,
  '{"min_words_total":520,"max_words_total":900,"required_sections":["intro","pain_points","expert_tip"],"forbidden_phrases":["In der heutigen Zeit","maßgeschneidert","Tauche ein","egal ob Anfänger oder Profi","Dieser Artikel zeigt dir alles"],"must_contain_curriculum_token":true}'::jsonb,
  true, 1),
('intent_durchfallquote_v1', 'intent_page', 'Intent: Durchfallquote pro Kompetenz', 'intent_durchfallquote',
  '["intro","pain_points","expert_tip"]'::jsonb,
  'Du bist erfahrener IHK-Prüfer und Lerncoach. Schreibe ehrlich, prüfungsnah, ohne Floskeln. Nenne KEINE konkreten Prozentzahlen, wenn sie nicht im Kontext stehen — sprich qualitativ über Schwierigkeit und typische Verlustquellen.',
  'Generiere drei Sektionen für die Intent-Seite "Durchfallquote/Schwierigkeit" zu "{competency_title}" im "{curriculum_title}". intro (180-260 Wörter, qualitative Einschätzung warum gerade diese Kompetenz Punkte kostet), pain_points (220-320 Wörter, 3-4 strukturelle Hürden), expert_tip (120-180 Wörter, Lernpfad-Empfehlung).',
  '{"forbidden_phrases":["garantiert bestehen","100% Durchfall","Bestehensgarantie"]}'::jsonb,
  '{"min_words_total":520,"max_words_total":900,"required_sections":["intro","pain_points","expert_tip"],"forbidden_phrases":["In der heutigen Zeit","maßgeschneidert","Tauche ein","garantiert bestehen","Bestehensgarantie"],"must_contain_curriculum_token":true}'::jsonb,
  true, 1),
('intent_wie_schwer_v1', 'intent_page', 'Intent: Wie schwer ist Kompetenz', 'intent_wie_schwer',
  '["intro","pain_points","expert_tip"]'::jsonb,
  'Du bist erfahrener IHK-Prüfer. Beantworte sachlich "wie schwer ist X" — keine Übertreibung, keine Verharmlosung.',
  'Generiere drei Sektionen für "Wie schwer ist {competency_title} im {curriculum_title}?". intro (180-260 Wörter, Schwierigkeitseinschätzung mit Bloom-Level Bezug), pain_points (220-320 Wörter, 3-4 Anforderungen die Kandidaten unterschätzen), expert_tip (120-180 Wörter, ehrliche Vorbereitungszeit-Empfehlung).',
  '{"forbidden_phrases":["kinderleicht","im Schlaf","ohne Vorbereitung"]}'::jsonb,
  '{"min_words_total":520,"max_words_total":900,"required_sections":["intro","pain_points","expert_tip"],"forbidden_phrases":["In der heutigen Zeit","maßgeschneidert","Tauche ein","kinderleicht","im Schlaf"],"must_contain_curriculum_token":true}'::jsonb,
  true, 1),
('intent_erfahrung_v1', 'intent_page', 'Intent: Erfahrungen pro Kompetenz', 'intent_erfahrung',
  '["intro","pain_points","expert_tip"]'::jsonb,
  'Du bist erfahrener IHK-Prüfer. Schreibe wie ein Coach, der hunderte Prüflinge begleitet hat — konkret, anekdotisch wirkend ohne erfundene Namen oder Zitate.',
  'Generiere drei Sektionen für "Erfahrungen mit {competency_title} ({curriculum_title}-Prüfung)". intro (180-260 Wörter, was Prüflinge typischerweise berichten — ohne Zitate erfinden), pain_points (220-320 Wörter, 3-4 wiederkehrende Stolperfallen aus Coaching-Sicht), expert_tip (120-180 Wörter, eine Routine die laut Erfahrung wirkt).',
  '{"forbidden_phrases":["Maria sagt","Paul berichtet","Originalbericht"]}'::jsonb,
  '{"min_words_total":520,"max_words_total":900,"required_sections":["intro","pain_points","expert_tip"],"forbidden_phrases":["In der heutigen Zeit","maßgeschneidert","Tauche ein","Maria sagt","Originalbericht"],"must_contain_curriculum_token":true}'::jsonb,
  true, 1),
('intent_lernplan_v1', 'intent_page', 'Intent: Lernplan pro Kompetenz', 'intent_lernplan',
  '["intro","pain_points","expert_tip"]'::jsonb,
  'Du bist erfahrener IHK-Prüfungstrainer. Liefere einen umsetzbaren Lernplan, ohne unrealistische Zeitversprechen.',
  'Generiere drei Sektionen für "Lernplan: {competency_title} ({curriculum_title})". intro (180-260 Wörter, Zielbild + Vorwissen-Check), pain_points (220-320 Wörter, 3-4 typische Lernplan-Fehler mit Fix), expert_tip (120-180 Wörter, ein 7-Tage-Sprint-Vorschlag mit 3 Meilensteinen).',
  '{"forbidden_phrases":["in 24 Stunden bestehen","ohne lernen","Last-Minute-Wunder"]}'::jsonb,
  '{"min_words_total":520,"max_words_total":900,"required_sections":["intro","pain_points","expert_tip"],"forbidden_phrases":["In der heutigen Zeit","maßgeschneidert","Tauche ein","in 24 Stunden bestehen","Last-Minute-Wunder"],"must_contain_curriculum_token":true}'::jsonb,
  true, 1)
ON CONFLICT (template_key) DO UPDATE
  SET intent_key = EXCLUDED.intent_key,
      outline_json = EXCLUDED.outline_json,
      prompt_system = EXCLUDED.prompt_system,
      prompt_user = EXCLUDED.prompt_user,
      style_rules_json = EXCLUDED.style_rules_json,
      qc_rules_json = EXCLUDED.qc_rules_json,
      is_active = true,
      updated_at = now();

-- 2) Public RPC: get_published_intent_page
CREATE OR REPLACE FUNCTION public.get_published_intent_page(
  p_curriculum_slug text,
  p_intent_slug text,
  p_competency_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT scp.id, scp.curriculum_id, scp.competency_id, scp.intent_template, scp.persona_type,
         scp.title, scp.meta_description, scp.slug, scp.sections_json, scp.faq_json,
         scp.quality_score, scp.last_generated_at, scp.generation_model, scp.status
    INTO v_row
  FROM public.seo_content_pages scp
  JOIN public.curricula c ON c.id = scp.curriculum_id
  JOIN public.competencies comp ON comp.id = scp.competency_id
  WHERE scp.status = 'published'
    AND scp.quality_score >= 80
    AND scp.intent_template IS NOT NULL
    AND fn_normalize_curriculum_slug(c.title) = p_curriculum_slug
    AND scp.intent_template = p_intent_slug
    AND lower(regexp_replace(comp.code || '-' || COALESCE(comp.title,''), '[^a-zA-Z0-9]+', '-', 'g')) LIKE p_competency_slug || '%'
  ORDER BY scp.last_generated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_published_intent_page(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_intent_page(text,text,text) TO anon, authenticated, service_role;

-- 3) Admin-only Smoke Enqueue Helper (6 AEVO Pages, 1 competency × 6 intents)
CREATE OR REPLACE FUNCTION public.admin_enqueue_seo_intent_smoke(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_persona_type text DEFAULT 'azubi'
)
RETURNS TABLE(intent_template text, job_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_intent text;
  v_job_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOREACH v_intent IN ARRAY ARRAY[
    'intent_pruefungsfragen',
    'intent_typische_fehler',
    'intent_durchfallquote',
    'intent_wie_schwer',
    'intent_erfahrung',
    'intent_lernplan'
  ]
  LOOP
    INSERT INTO public.job_queue (job_type, job_name, status, payload, priority, run_after, correlation_id)
    VALUES (
      'seo_intent_page_generate',
      'seo_intent_smoke:' || v_intent,
      'pending',
      jsonb_build_object(
        'curriculum_id', p_curriculum_id,
        'competency_id', p_competency_id,
        'intent_template', v_intent,
        'persona_type', p_persona_type,
        'enqueue_source', 'admin_smoke_loop_a'
      ),
      5,
      now(),
      gen_random_uuid()
    )
    RETURNING id INTO v_job_id;

    intent_template := v_intent;
    job_id := v_job_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enqueue_seo_intent_smoke(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_seo_intent_smoke(uuid,uuid,text) TO authenticated, service_role;

-- 4) Audit
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'seo_intent_loop_a_migration',
  'system',
  NULL,
  'success',
  jsonb_build_object(
    'templates_added', 5,
    'rpc_added', ARRAY['get_published_intent_page','admin_enqueue_seo_intent_smoke'],
    'note', 'Loop A foundation; edge function next.'
  )
);