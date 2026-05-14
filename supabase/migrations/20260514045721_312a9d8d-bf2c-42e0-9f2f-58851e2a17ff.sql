-- Slice 1 / Migration 2: SSOT-Skelett + Template-Seed + Admin-RPC

-- 1) SSOT-Skelett-Funktion (deterministisch, kein AI)
CREATE OR REPLACE FUNCTION public.fn_seo_build_ssot_skeleton(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_intent_template text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr record;
  v_comp record;
  v_lf record;
  v_curr_slug text;
  v_comp_slug text;
  v_intent_label text;
  v_h1 text;
  v_meta_desc text;
  v_breadcrumbs jsonb;
  v_faq_seed jsonb;
  v_internal_links jsonb;
  v_cta jsonb;
  v_siblings jsonb;
BEGIN
  SELECT id, title, certification_id, certification_type, track INTO v_curr
  FROM curricula WHERE id = p_curriculum_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'curriculum_not_found: %', p_curriculum_id;
  END IF;

  SELECT id, code, title, description, learning_field_id, bloom_level, exam_relevance_tier
    INTO v_comp
  FROM competencies WHERE id = p_competency_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'competency_not_found: %', p_competency_id;
  END IF;

  SELECT id, code, title INTO v_lf
  FROM learning_fields WHERE id = v_comp.learning_field_id;

  v_curr_slug := fn_normalize_curriculum_slug(v_curr.title);
  v_comp_slug := lower(regexp_replace(v_comp.code || '-' || COALESCE(v_comp.title,''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_comp_slug := trim(both '-' from substring(v_comp_slug from 1 for 80));

  -- Intent-Label-Mapping
  v_intent_label := CASE p_intent_template
    WHEN 'intent_pruefungsfragen' THEN 'Prüfungsfragen'
    WHEN 'intent_typische_fehler' THEN 'Typische Fehler'
    WHEN 'intent_durchfallquote' THEN 'Durchfallquote'
    WHEN 'intent_wie_schwer' THEN 'Wie schwer ist'
    WHEN 'intent_erfahrung' THEN 'Erfahrungen'
    WHEN 'intent_lernplan' THEN 'Lernplan'
    ELSE p_intent_template
  END;

  -- H1 + Meta-Description per Intent
  v_h1 := CASE p_intent_template
    WHEN 'intent_pruefungsfragen' THEN v_comp.title || ' — Prüfungsfragen für ' || v_curr.title
    WHEN 'intent_typische_fehler' THEN 'Typische Fehler bei „' || v_comp.title || '" (' || v_curr.title || ')'
    WHEN 'intent_durchfallquote' THEN 'Durchfallquote ' || v_curr.title || ' — Schwerpunkt ' || v_comp.title
    WHEN 'intent_wie_schwer' THEN 'Wie schwer ist ' || v_comp.title || ' im ' || v_curr.title || '?'
    WHEN 'intent_erfahrung' THEN v_comp.title || ' — Erfahrungen aus der ' || v_curr.title || '-Prüfung'
    WHEN 'intent_lernplan' THEN 'Lernplan: ' || v_comp.title || ' (' || v_curr.title || ')'
    ELSE v_intent_label || ' — ' || v_comp.title
  END;

  v_meta_desc := substring(
    v_intent_label || ' für ' || v_comp.title || ' im ' || v_curr.title ||
    '. Praxisnahe Inhalte, echte Prüfungsfälle, sofort einsetzbar im Trainer.'
    from 1 for 158
  );

  -- Breadcrumbs
  v_breadcrumbs := jsonb_build_array(
    jsonb_build_object('label','Start','href','/'),
    jsonb_build_object('label', v_curr.title, 'href', '/lernen/' || v_curr_slug),
    jsonb_build_object('label', COALESCE(v_lf.title, 'Lernfeld'), 'href', '/lernen/' || v_curr_slug),
    jsonb_build_object('label', v_h1, 'href', null)
  );

  -- FAQ-Seed (intent-spezifisch, deterministisch)
  v_faq_seed := CASE p_intent_template
    WHEN 'intent_pruefungsfragen' THEN jsonb_build_array(
      jsonb_build_object('q', 'Welche Fragen kommen in „' || v_comp.title || '" wirklich dran?', 'a_seed', 'core_topics_from_competency'),
      jsonb_build_object('q', 'Wie viele Fragen zu „' || v_comp.title || '" tauchen typischerweise auf?', 'a_seed', 'pool_distribution'),
      jsonb_build_object('q', 'Reicht es, nur „' || v_comp.title || '" zu lernen?', 'a_seed', 'tier_relevance:' || COALESCE(v_comp.exam_relevance_tier, 'unknown'))
    )
    WHEN 'intent_typische_fehler' THEN jsonb_build_array(
      jsonb_build_object('q', 'Welcher Fehler kostet bei „' || v_comp.title || '" die meisten Punkte?', 'a_seed', 'top_misconception'),
      jsonb_build_object('q', 'Wie vermeide ich Flüchtigkeitsfehler in dieser Aufgabe?', 'a_seed', 'practice_pattern')
    )
    ELSE jsonb_build_array()
  END;

  -- Top-3 Sibling-Competencies (gleiches Lernfeld)
  SELECT COALESCE(jsonb_agg(s ORDER BY s->>'sort_order'), '[]'::jsonb) INTO v_siblings
  FROM (
    SELECT jsonb_build_object(
      'label', c2.title,
      'href', '/lernen/' || v_curr_slug || '/' || p_intent_template || '/' ||
              lower(regexp_replace(c2.code || '-' || c2.title, '[^a-zA-Z0-9]+', '-', 'g')),
      'sort_order', c2.sort_order
    ) AS s
    FROM competencies c2
    WHERE c2.learning_field_id = v_comp.learning_field_id
      AND c2.id <> p_competency_id
    ORDER BY c2.sort_order
    LIMIT 3
  ) sub;

  -- Internal Links: Siblings + Hub + Quiz + Trainer + Tutor
  v_internal_links := jsonb_build_object(
    'siblings', v_siblings,
    'hub', jsonb_build_object('label', v_curr.title || ' — Übersicht', 'href', '/lernen/' || v_curr_slug),
    'quiz', jsonb_build_object('label', 'Kostenloses Quiz starten', 'href', '/quiz?curriculum=' || v_curr_slug),
    'trainer', jsonb_build_object('label', 'Prüfungstrainer öffnen', 'href', '/lernen/' || v_curr_slug || '/trainer'),
    'tutor', jsonb_build_object('label', 'Mit AI-Tutor üben', 'href', '/tutor?competency=' || v_comp.id::text)
  );

  -- CTA-Block (intent-abhängig)
  v_cta := jsonb_build_object(
    'primary', CASE p_intent_template
      WHEN 'intent_pruefungsfragen' THEN jsonb_build_object('label', 'Diese Frage jetzt im Trainer üben', 'href', '/lernen/' || v_curr_slug || '/trainer?competency=' || v_comp.id::text, 'event', 'cta_intent_pruefungsfragen_trainer')
      WHEN 'intent_typische_fehler' THEN jsonb_build_object('label', 'Schwachstellen-Quiz starten', 'href', '/quiz?focus=' || v_comp.id::text, 'event', 'cta_intent_typische_fehler_quiz')
      ELSE jsonb_build_object('label', 'Jetzt loslegen', 'href', '/lernen/' || v_curr_slug)
    END,
    'secondary', jsonb_build_object('label', 'Zum AI-Tutor', 'href', '/tutor?competency=' || v_comp.id::text)
  );

  RETURN jsonb_build_object(
    'curriculum', jsonb_build_object('id', v_curr.id, 'title', v_curr.title, 'slug', v_curr_slug),
    'competency', jsonb_build_object('id', v_comp.id, 'code', v_comp.code, 'title', v_comp.title, 'description', v_comp.description, 'slug', v_comp_slug, 'tier', v_comp.exam_relevance_tier, 'bloom', v_comp.bloom_level),
    'learning_field', jsonb_build_object('id', v_lf.id, 'title', v_lf.title),
    'intent_template', p_intent_template,
    'intent_label', v_intent_label,
    'h1', v_h1,
    'meta_description', v_meta_desc,
    'slug', v_curr_slug || '/' || p_intent_template || '/' || v_comp_slug,
    'breadcrumbs', v_breadcrumbs,
    'faq_seed', v_faq_seed,
    'internal_links', v_internal_links,
    'cta', v_cta,
    'ai_sections_required', jsonb_build_array('intro_paragraph', 'pain_point_paragraph', 'expert_tip')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_seo_build_ssot_skeleton(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seo_build_ssot_skeleton(uuid,uuid,text) TO service_role, authenticated;

-- 2) Erstes Template seeden: intent_pruefungsfragen_v1
INSERT INTO public.seo_templates (template_key, doc_type, intent_key, display_name, outline_json, prompt_system, style_rules_json, qc_rules_json, is_active, version)
VALUES (
  'intent_pruefungsfragen_v1',
  'intent_page',
  'intent_pruefungsfragen',
  'Intent: Prüfungsfragen pro Kompetenz',
  '[
    {"key":"hero","type":"static","source":"ssot.h1+ssot.intro_paragraph"},
    {"key":"intro_paragraph","type":"ai","max_words":120,"role":"einstieg"},
    {"key":"pain_point_paragraph","type":"ai","max_words":140,"role":"problem_anerkennen"},
    {"key":"key_facts","type":"static","source":"ssot.competency.tier+ssot.competency.bloom"},
    {"key":"sample_questions","type":"static","source":"ssot.faq_seed"},
    {"key":"expert_tip","type":"ai","max_words":80,"role":"praxis_tipp"},
    {"key":"internal_links","type":"static","source":"ssot.internal_links"},
    {"key":"cta","type":"static","source":"ssot.cta"}
  ]'::jsonb,
  'Du schreibst für ExamFit.de — eine KI-gestützte IHK-Prüfungstrainings-Plattform. Tonalität: ein erfahrener IHK-Prüfer, der einem Prüfungskandidaten direkt ins Gesicht spricht. Kurze Sätze. Konkrete Beispiele. Keine Floskeln.

VERBOTEN (führt zu sofortiger Ablehnung):
- "In diesem Artikel erfahren Sie..."
- "Willkommen", "Hallo zusammen"
- "wertvolle Einblicke", "tiefgreifend", "umfassend"
- "Lassen Sie uns ... eintauchen"
- "Im heutigen schnelllebigen ..."
- "Es ist wichtig zu beachten"
- jede generische SEO-Phrase

PFLICHT:
- Beziehe dich auf die konkrete Kompetenz, nicht auf den Beruf allgemein
- Nenne Stolpersteine, die echte Prüfungskandidaten machen
- Schreibe so, dass jemand mit Prüfungsangst sofort sagt: "Ja, genau das meine ich"',
  '{"max_filler_words_pct":2,"forbidden_phrases":["erfahren Sie","willkommen","wertvolle Einblicke","eintauchen","schnelllebigen","es ist wichtig zu beachten","in diesem artikel"],"required_entities_from":["competency.title","curriculum.title"]}'::jsonb,
  '{"min_words_per_section":50,"max_words_total":600,"min_quality_score":75}'::jsonb,
  true,
  1
)
ON CONFLICT (template_key) DO UPDATE SET
  doc_type = EXCLUDED.doc_type,
  intent_key = EXCLUDED.intent_key,
  outline_json = EXCLUDED.outline_json,
  prompt_system = EXCLUDED.prompt_system,
  style_rules_json = EXCLUDED.style_rules_json,
  qc_rules_json = EXCLUDED.qc_rules_json,
  updated_at = now(),
  version = public.seo_templates.version + 1;

-- 3) Admin-RPC: Enqueue Intent-Page-Generation
CREATE OR REPLACE FUNCTION public.admin_enqueue_seo_intent_generation(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_intent_template text,
  p_persona_type text DEFAULT 'azubi'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_template_key text;
  v_existing uuid;
  v_job_id uuid;
BEGIN
  IF v_caller IS NULL OR NOT has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  -- Template auflösen über intent_key (latest active version)
  SELECT template_key INTO v_template_key
  FROM seo_templates
  WHERE intent_key = p_intent_template AND is_active = true
  ORDER BY version DESC
  LIMIT 1;
  IF v_template_key IS NULL THEN
    RAISE EXCEPTION 'no_active_template_for_intent: %', p_intent_template;
  END IF;

  -- Existierende Page?
  SELECT id INTO v_existing FROM seo_content_pages
  WHERE curriculum_id = p_curriculum_id
    AND competency_id = p_competency_id
    AND intent_template = p_intent_template
    AND persona_type = p_persona_type;

  -- Existierender queued/running Job?
  IF EXISTS (
    SELECT 1 FROM seo_generation_jobs
    WHERE template_key = v_template_key
      AND status IN ('queued','running')
      AND target_ref->>'curriculum_id' = p_curriculum_id::text
      AND target_ref->>'competency_id' = p_competency_id::text
      AND target_ref->>'persona_type' = p_persona_type
  ) THEN
    RETURN jsonb_build_object('status','already_queued','curriculum_id',p_curriculum_id,'competency_id',p_competency_id,'intent',p_intent_template);
  END IF;

  INSERT INTO seo_generation_jobs (job_type, template_key, target_ref, status)
  VALUES (
    'generate',
    v_template_key,
    jsonb_build_object(
      'curriculum_id', p_curriculum_id,
      'competency_id', p_competency_id,
      'intent_template', p_intent_template,
      'persona_type', p_persona_type,
      'existing_page_id', v_existing
    ),
    'queued'
  )
  RETURNING id INTO v_job_id;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'seo_intent_generation_enqueued',
    'seo_intent_page',
    v_job_id::text,
    'success',
    jsonb_build_object(
      'curriculum_id', p_curriculum_id,
      'competency_id', p_competency_id,
      'intent_template', p_intent_template,
      'persona_type', p_persona_type,
      'template_key', v_template_key,
      'existing_page_id', v_existing
    )
  );

  RETURN jsonb_build_object(
    'status','enqueued',
    'job_id', v_job_id,
    'template_key', v_template_key,
    'existing_page_id', v_existing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enqueue_seo_intent_generation(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_seo_intent_generation(uuid,uuid,text,text) TO authenticated;

-- Smoke-Test: SSOT-Skelett für irgendeine echte Kompetenz aufrufen
DO $$
DECLARE
  v_curr uuid;
  v_comp uuid;
  v_skeleton jsonb;
BEGIN
  SELECT c.id, comp.id INTO v_curr, v_comp
  FROM curricula c
  JOIN learning_fields lf ON lf.curriculum_id = c.id
  JOIN competencies comp ON comp.learning_field_id = lf.id
  LIMIT 1;
  IF v_curr IS NULL OR v_comp IS NULL THEN
    RAISE NOTICE 'Smoke skipped: no curriculum/competency found';
    RETURN;
  END IF;
  v_skeleton := fn_seo_build_ssot_skeleton(v_curr, v_comp, 'intent_pruefungsfragen');
  IF v_skeleton->>'h1' IS NULL OR v_skeleton->>'slug' IS NULL THEN
    RAISE EXCEPTION 'Smoke FAIL: skeleton missing h1/slug';
  END IF;
  RAISE NOTICE 'Smoke OK: skeleton built for curr=% comp=% h1=%', v_curr, v_comp, v_skeleton->>'h1';
END $$;