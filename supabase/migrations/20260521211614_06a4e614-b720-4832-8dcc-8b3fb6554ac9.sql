
UPDATE public.blog_articles
SET article_type = 'pillar_guide'
WHERE article_type = 'pillar'
  AND (slug LIKE 'pruefungsfragen-%-pillar-guide' OR slug LIKE 'pruefungsvorbereitung-%-pillar-guide');

INSERT INTO public.certification_catalog (title, slug, catalog_type, chamber_type, recognition_type, track, priority_score, notes)
SELECT * FROM (VALUES
  ('Bankkaufmann/-frau (IHK)', 'bankkaufmann-ihk', 'Ausbildung', 'IHK', 'chamber', 'EXAM_FIRST', 8.5::numeric,
   'Phase C bootstrap 2026-05-21 — Semrush abschlussprüfung 70/mo. Package + pricing pending.'),
  ('Pflegefachmann/-frau', 'pflegefachmann', 'Ausbildung', 'Staatlich', 'public_law', 'EXAM_FIRST', 7.0::numeric,
   'Phase C bootstrap 2026-05-21 — generalistische Pflegeausbildung (PflBG). Package + pricing pending.')
) AS v(title, slug, catalog_type, chamber_type, recognition_type, track, priority_score, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.certification_catalog c WHERE c.slug = v.slug);

WITH berufe(catalog_slug, label) AS (
  VALUES
    ('verkaeufer-in', 'Verkäufer/-in'),
    ('kaufmann-einzelhandel-ihk', 'Kaufmann im Einzelhandel'),
    ('industriekaufmann-ihk', 'Industriekaufmann'),
    ('kaufmann-bueromanagement-ihk', 'Kaufmann für Büromanagement'),
    ('bilanzbuchhalter-ihk', 'Bilanzbuchhalter'),
    ('aevo', 'AEVO'),
    ('personalfachkaufmann-ihk', 'Personalfachkaufmann'),
    ('fachinformatiker-anwendungsentwicklung', 'Fachinformatiker Anwendungsentwicklung'),
    ('fachkraft-fuer-lagerlogistik', 'Fachkraft für Lagerlogistik'),
    ('anlagenmechaniker', 'Anlagenmechaniker SHK'),
    ('kraftfahrzeugmechatroniker-in', 'Kfz-Mechatroniker'),
    ('mechatroniker-in', 'Mechatroniker'),
    ('elektroniker-gebaeude', 'Elektroniker für Gebäude- und Infrastruktursysteme'),
    ('kfz-meister-hwk', 'Kfz-Meister'),
    ('shk-meister-hwk', 'SHK-Meister'),
    ('friseur-meister-hwk', 'Friseur-Meister'),
    ('mfa', 'MFA'),
    ('steuerfachangestellte', 'Steuerfachangestellte'),
    ('kaufmann-it-system-management', 'Kaufmann für IT-System-Management'),
    ('kaufmann-digitalisierungsmanagement', 'Kaufmann für Digitalisierungsmanagement')
),
intents(sub_intent, intent_template) AS (
  VALUES
    ('abschlusspruefung', 'abschlussprüfung %s'),
    ('zwischenpruefung',  'zwischenprüfung %s'),
    ('pruefung-ihk',      'prüfung %s ihk')
),
seed AS (
  SELECT
    b.catalog_slug || '__' || i.sub_intent AS keyword_slug,
    format(i.intent_template, lower(b.label)) AS keyword_text,
    i.sub_intent,
    b.label,
    b.catalog_slug
  FROM berufe b CROSS JOIN intents i
)
INSERT INTO public.growth_keyword_registry
  (keyword_slug, keyword_text, persona, funnel_stage, canonical_intent, owner_kind, status, notes)
SELECT s.keyword_slug, s.keyword_text, 'azubi', 'exam_prep', 'informational', 'reserved', 'reserved',
       'wave4:' || s.sub_intent || ' | catalog=' || s.catalog_slug || ' | beruf=' || s.label || ' | source=Semrush DE 2026-05'
FROM seed s
WHERE NOT EXISTS (
  SELECT 1 FROM public.growth_keyword_registry r WHERE r.keyword_slug = s.keyword_slug
);

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'wave4_realignment_seed',
  'system',
  'success',
  jsonb_build_object(
    'pillar_guide_count', (SELECT COUNT(*) FROM public.blog_articles WHERE article_type='pillar_guide'),
    'wave4_keywords', (SELECT COUNT(*) FROM public.growth_keyword_registry WHERE keyword_slug LIKE '%__abschlusspruefung' OR keyword_slug LIKE '%__zwischenpruefung' OR keyword_slug LIKE '%__pruefung-ihk'),
    'catalog_bootstrap', ARRAY['bankkaufmann-ihk','pflegefachmann']
  )
);
