
-- BLOG.META.DESCRIPTION.OPTIMIZE.10 — idempotent: nur überschreiben, wenn aktuell < 70 Zeichen.
UPDATE public.blog_articles SET meta_description = v.md, updated_at = now()
FROM (VALUES
  ('645cb1e0-4888-40cb-a88b-da4c5a4681a1'::uuid, 'ITIL 4 Foundation Zertifizierung im Überblick: Inhalte, Kosten, Prüfungsablauf und Karrierechancen. Alle Module, Lernzeit und Tipps für den ersten Versuch.'),
  ('ceb37376-2681-4ee0-abe5-432eb3479ac5'::uuid, 'PRINCE2 oder Scrum? Ehrlicher Vergleich beider Zertifizierungen: Kosten, Gehalt, Anerkennung und für welche Rolle sich welche wirklich auszahlt.'),
  ('09cbb882-a6dd-47a1-91c6-224b8ad9bc83'::uuid, 'Kaufmann für Büromanagement Prüfung bestehen: Aufbau, Wahlqualifikationen, Lernplan und konkrete Tipps für Teil 1, Teil 2 und das Fachgespräch.'),
  ('f9b5f0c6-54cd-4fd0-843b-a3877e269ff4'::uuid, 'Datenschutzbeauftragter mit TÜV-Zertifizierung werden: Voraussetzungen, Lehrgangsdauer, Kosten, Aufgaben im Job und Gehalt – alles auf einen Blick.'),
  ('efb05b1f-c3dd-49d1-9d89-210dd676c1fd'::uuid, 'Wirtschaftsfachwirt IHK – ehrlicher Erfahrungsbericht nach 18 Monaten: Kosten, Lernaufwand, Prüfungsdruck und ob sich der Aufstieg wirklich lohnt.'),
  ('ee2eea13-e8a0-4ab5-9590-ec759df7ca1d'::uuid, 'Mündliche IHK-Prüfung bestehen: Aufbau, Bewertungskriterien, Präsentationstipps und die häufigsten Fragen der Prüfer – mit Lernplan zum Direktstart.'),
  ('11bf43e0-4d62-4d4d-b6b1-f5946b245e86'::uuid, 'IHK Prüfung bestehen: die besten Strategien für Azubis – realistischer Lernplan, Prüfungssimulation und mentale Tipps für den ersten Versuch.'),
  ('4a5b6db7-8356-41b1-84d5-aac7973c107e'::uuid, 'AEVO Ausbilderschein 2026: Kosten, Dauer, Inhalte der schriftlichen und praktischen Prüfung sowie Karrierevorteile – lohnt sich die Investition wirklich?'),
  ('427832cd-aed1-4fc2-8ac7-35f918246186'::uuid, 'IHK Prüfung Teil 1 vs. Teil 2 verständlich erklärt: Unterschiede in Inhalt, Gewichtung, Zeitpunkt und Bestehensgrenze – plus Lernstrategie für beide Teile.'),
  ('043339cc-222e-4cf7-beb7-1c8c8fd793f1'::uuid, 'Industriekaufmann Abschlussprüfung bestehen: konkrete Tipps zu Geschäftsprozessen, KSK, Lernplan und Prüfungssimulation – inklusive Last-Minute-Strategie.')
) AS v(id, md)
WHERE public.blog_articles.id = v.id
  AND length(coalesce(public.blog_articles.meta_description,'')) < 70;
