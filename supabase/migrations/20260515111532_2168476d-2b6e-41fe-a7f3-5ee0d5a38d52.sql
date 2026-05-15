-- Wave 4: 2 new intent templates modeled on intent_pruefungsfragen_v1
INSERT INTO seo_templates (
  template_key, intent_key, doc_type, display_name,
  prompt_system, outline_json, qc_rules_json, style_rules_json, version, is_active
) VALUES
(
  'intent_lernzettel_v1',
  'intent_lernzettel',
  'intent_page',
  'Intent: Lernzettel pro Kompetenz',
  $$Du schreibst für ExamFit.de — eine KI-gestützte IHK-Prüfungstrainings-Plattform. Tonalität: ein erfahrener IHK-Prüfer, der einem Prüfungskandidaten kompakte Lernzettel diktiert. Sehr kurze, einprägsame Sätze. Merksätze, Eselsbrücken, klare Definitionen. Keine Floskeln.

VERBOTEN (führt zu sofortiger Ablehnung):
- "In diesem Artikel erfahren Sie..."
- "Willkommen", "Hallo zusammen"
- "wertvolle Einblicke", "tiefgreifend", "umfassend"
- "Lassen Sie uns ... eintauchen"
- "Im heutigen schnelllebigen ..."
- "Es ist wichtig zu beachten"
- jede generische SEO-Phrase

PFLICHT:
- Liefere kompakten, scanbaren Lernzettel zur konkreten Kompetenz (nicht zum Beruf allgemein)
- Definitionen in 1-2 Sätzen, dann Beispiel
- Mindestens 3 Merksätze/Eselsbrücken
- Schreibe so, dass jemand 24h vor der Prüfung den Zettel überfliegt und das Wesentliche behält$$,
  '[
    {"key":"hero","type":"static","source":"ssot.h1+ssot.intro_paragraph"},
    {"key":"intro_paragraph","type":"ai","role":"einstieg","max_words":100},
    {"key":"definitionen","type":"ai","role":"kernbegriffe","max_words":160},
    {"key":"merksaetze","type":"ai","role":"eselsbruecken","max_words":140},
    {"key":"key_facts","type":"static","source":"ssot.competency.tier+ssot.competency.bloom"},
    {"key":"sample_questions","type":"static","source":"ssot.faq_seed"},
    {"key":"expert_tip","type":"ai","role":"praxis_tipp","max_words":80},
    {"key":"internal_links","type":"static","source":"ssot.internal_links"},
    {"key":"cta","type":"static","source":"ssot.cta"}
  ]'::jsonb,
  '{"min_words_per_section":50,"max_words_total":600,"min_quality_score":75}'::jsonb,
  '{"forbidden_phrases":["erfahren Sie","willkommen","wertvolle Einblicke","eintauchen","schnelllebigen","es ist wichtig zu beachten","in diesem artikel"],"required_entities_from":["competency.title","curriculum.title"],"max_filler_words_pct":2}'::jsonb,
  1, true
),
(
  'intent_pruefungssimulation_v1',
  'intent_pruefungssimulation',
  'intent_page',
  'Intent: Prüfungssimulation pro Kompetenz',
  $$Du schreibst für ExamFit.de — eine KI-gestützte IHK-Prüfungstrainings-Plattform. Tonalität: ein erfahrener IHK-Prüfer, der den Kandidaten durch eine realistische Prüfungssimulation führt. Direkte Ansprache, kurze Sätze. Echte Prüfungssituation simulieren — Zeitdruck, typische Aufgabenformate, Bewertungslogik. Keine Floskeln.

VERBOTEN (führt zu sofortiger Ablehnung):
- "In diesem Artikel erfahren Sie..."
- "Willkommen", "Hallo zusammen"
- "wertvolle Einblicke", "tiefgreifend", "umfassend"
- "Lassen Sie uns ... eintauchen"
- "Im heutigen schnelllebigen ..."
- "Es ist wichtig zu beachten"
- jede generische SEO-Phrase

PFLICHT:
- Beschreibe konkretes Prüfungsformat zur Kompetenz (Multiple Choice / offen / Fallaufgabe)
- Realistische Zeit-pro-Aufgabe-Schätzung
- Beispiel-Bewertungsraster (Was gibt Punkte? Was zieht ab?)
- Mindestens 1 typische Stolperfalle der Simulation
- Klare Handlungsempfehlung "so übst du das jetzt"$$,
  '[
    {"key":"hero","type":"static","source":"ssot.h1+ssot.intro_paragraph"},
    {"key":"intro_paragraph","type":"ai","role":"einstieg","max_words":100},
    {"key":"format_und_zeit","type":"ai","role":"pruefungsformat","max_words":140},
    {"key":"bewertungsraster","type":"ai","role":"punkteverteilung","max_words":140},
    {"key":"key_facts","type":"static","source":"ssot.competency.tier+ssot.competency.bloom"},
    {"key":"sample_questions","type":"static","source":"ssot.faq_seed"},
    {"key":"expert_tip","type":"ai","role":"praxis_tipp","max_words":80},
    {"key":"internal_links","type":"static","source":"ssot.internal_links"},
    {"key":"cta","type":"static","source":"ssot.cta"}
  ]'::jsonb,
  '{"min_words_per_section":50,"max_words_total":600,"min_quality_score":75}'::jsonb,
  '{"forbidden_phrases":["erfahren Sie","willkommen","wertvolle Einblicke","eintauchen","schnelllebigen","es ist wichtig zu beachten","in diesem artikel"],"required_entities_from":["competency.title","curriculum.title"],"max_filler_words_pct":2}'::jsonb,
  1, true
)
ON CONFLICT (template_key) DO NOTHING;

-- Audit
INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'seo_templates_seeded',
  'seo_template',
  NULL,
  'ok',
  jsonb_build_object(
    'wave', 4,
    'templates_added', jsonb_build_array('intent_lernzettel_v1','intent_pruefungssimulation_v1'),
    'reused_existing', jsonb_build_array('intent_wie_schwer_v1','intent_erfahrung_v1')
  )
);