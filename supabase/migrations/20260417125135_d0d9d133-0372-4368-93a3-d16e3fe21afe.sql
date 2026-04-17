
-- =====================================================================
-- RESEED 7 ZERTIFIKATSKURSE (Berater/Pfleger-Familie)
-- Quellen: BdB, AGT, BAG Familie, BVEB, BGB, FamFG, SGB VIII, KKG, BtOG
-- =====================================================================

-- Schritt 1: Purge boilerplate für alle 7 Curricula
DO $$
DECLARE
  v_curriculum_ids uuid[] := ARRAY[
    'fce1158a-caa6-4873-80aa-16fd8f016688'::uuid, -- Familienpsychologischer Gutachter
    'ffb96610-25b8-4652-aa6b-3bad77bfce62'::uuid, -- Erbschaftsplanung
    'cc1d59a8-0172-4a48-8688-4d43bdea375d'::uuid, -- Kinderschutz Sex. Gewalt
    '3d8bd5bf-abc4-4564-ad9b-86d821250aa2'::uuid, -- Kinderschutzfachkraft IseF
    'e4ed48be-4672-485b-b8bf-3eab4f8b3c44'::uuid, -- Umgangsbegleitung
    'd5428612-e734-40d3-86fb-d69e7dbbbec0'::uuid, -- Umgangspfleger
    '3be4c9af-0fe1-4c42-9352-3f3d0b3a743d'::uuid  -- Verfahrenspflegschaft Betreuung
  ];
  v_lf_ids uuid[];
  v_comp_ids uuid[];
BEGIN
  -- Sammle alle alten LF/Comp-IDs
  SELECT array_agg(id) INTO v_lf_ids FROM learning_fields WHERE curriculum_id = ANY(v_curriculum_ids);
  SELECT array_agg(id) INTO v_comp_ids FROM competencies WHERE learning_field_id = ANY(v_lf_ids);

  -- Cleanup downstream FKs
  IF v_comp_ids IS NOT NULL THEN
    DELETE FROM blueprint_targets WHERE competency_id = ANY(v_comp_ids);
    DELETE FROM exam_questions WHERE competency_id = ANY(v_comp_ids);
    DELETE FROM handbook_sections WHERE competency_id = ANY(v_comp_ids);
  END IF;

  -- Delete competencies & learning_fields
  DELETE FROM competencies WHERE learning_field_id = ANY(v_lf_ids);
  DELETE FROM learning_fields WHERE curriculum_id = ANY(v_curriculum_ids);
END $$;

-- =====================================================================
-- KURS 4: Familienpsychologischer Gutachter
-- Quellen: BAG Familie, FamFG §163, ZPO §404a, S2-Leitlinie Psychologische Begutachtung
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF1',  'Rechtliche Grundlagen familienpsychologischer Begutachtung', 'FamFG §163, ZPO §404a, BGB §1671/§1684/§1696, BVerfG-Rechtsprechung', 1),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF2',  'Auftragsklärung und Beweisfragen', 'Beweisfrage des Gerichts, Gutachtenauftrag, Abgrenzung zu Stellungnahmen', 2),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF3',  'Diagnostische Methoden und Testverfahren', 'Anamnese, Exploration, Verhaltensbeobachtung, standardisierte Tests, projektive Verfahren', 3),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF4',  'Kindeswohl und Kindesinteressen', 'Kindeswohlkriterien (Förder-, Kontinuitäts-, Bindungs-, Willens-Prinzip)', 4),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF5',  'Bindungstheorie und Bindungsdiagnostik', 'Bowlby/Ainsworth, Strange Situation, Attachment Story Completion Task', 5),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF6',  'Hochkonflikthafte Trennung und Eltern-Kind-Entfremdung', 'PAS-Diskussion, induzierte Ablehnung, Loyalitätskonflikte', 6),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF7',  'Kindeswohlgefährdung im Sorge-/Umgangsverfahren', 'BGB §1666, Risikoeinschätzung, Schutzkonzepte', 7),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF8',  'Erziehungsfähigkeit und Erziehungseignung', 'Operationalisierung, Diagnostik, Prognose', 8),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF9',  'Interaktionsbeobachtung Eltern-Kind', 'EAS, CARE-Index, Mannheimer Beurteilungsskala', 9),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF10', 'Lösungsorientierte Begutachtung', 'Mediative Elemente, Beratungsanteil im Gutachten, BGH-Rechtsprechung', 10),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF11', 'Gutachtenerstellung und Berichtsstandards', 'AWMF-Leitlinie, Mindeststandards Familienpsychologische Gutachten', 11),
  ('fce1158a-caa6-4873-80aa-16fd8f016688', 'LF12', 'Berufsethik, Qualitätssicherung und Honorierung', 'JVEG, Befangenheit, Schweigepflicht, Supervision', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'analyze', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Rechtsgrundlagen', 'Rechtliche Verankerung der Begutachtung'),
  (2, lf.code || '.2 Methodik', 'Methodische Standards anwenden'),
  (3, lf.code || '.3 Diagnostik', 'Diagnostische Verfahren auswählen'),
  (4, lf.code || '.4 Bewertung', 'Befunde integrieren und bewerten'),
  (5, lf.code || '.5 Berichterstattung', 'Ergebnisse rechtssicher dokumentieren')
) AS c(idx, title, descr);

-- =====================================================================
-- KURS 5: Erbschaftsplanung (Estate Planning)
-- Quellen: BGB Buch 5, ErbStG, AO, BNotO, Bundesverband der Erbenermittler
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF1',  'Grundlagen des Erbrechts', 'BGB §§1922 ff., gesetzliche und gewillkürte Erbfolge', 1),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF2',  'Testament und Erbvertrag', 'BGB §§2229 ff./§§2274 ff., Formvorschriften, Auslegung', 2),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF3',  'Pflichtteil und Pflichtteilsergänzung', 'BGB §§2303-2338, Berechnung, Anrechnung, Verzicht', 3),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF4',  'Vor- und Nacherbschaft, Vermächtnis, Auflage', 'BGB §§2100 ff./§§2147 ff./§§2192 ff.', 4),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF5',  'Erbengemeinschaft und Auseinandersetzung', 'BGB §§2032 ff., Verwaltung, Teilungsanordnung, Teilungsversteigerung', 5),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF6',  'Erbschaftsteuer und Schenkungsteuer', 'ErbStG, Steuerklassen, Freibeträge, Bewertungsverfahren', 6),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF7',  'Vorweggenommene Erbfolge und Schenkung', 'Übergabeverträge, Nießbrauch, Wohnrecht, Rückforderungsrechte', 7),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF8',  'Unternehmens- und Immobiliennachfolge', 'ErbStG §§13a/13b, Verschonungsabschlag, Pool-Vereinbarungen', 8),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF9',  'Internationales Erbrecht (EU-ErbVO)', 'EU-Verordnung 650/2012, gewöhnlicher Aufenthalt, Rechtswahl, ENZ', 9),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF10', 'Vorsorgeinstrumente: Vollmacht, Patientenverfügung, Betreuungsverfügung', 'BGB §§1814 ff., BtOG, formale Anforderungen', 10),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF11', 'Stiftung, Familienpool und Trust', 'BGB §§80 ff., Familienstiftung, ausländische Trusts (steuerlich)', 11),
  ('ffb96610-25b8-4652-aa6b-3bad77bfce62', 'LF12', 'Beratungsmandat, Haftung und Berufsrecht', 'RDG, Honorarmodelle, Berufshaftpflicht, Schnittstelle Notar/Steuerberater', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'apply', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Rechtsnormen', 'Anwendbare Normen identifizieren'),
  (2, lf.code || '.2 Gestaltung', 'Gestaltungsoptionen entwickeln'),
  (3, lf.code || '.3 Berechnung', 'Quoten/Werte/Steuern berechnen'),
  (4, lf.code || '.4 Risikoanalyse', 'Risiken und Fallstricke identifizieren'),
  (5, lf.code || '.5 Beratung', 'Mandanten rechtssicher beraten')
) AS c(idx, title, descr);

-- =====================================================================
-- KURS 6: Kinderschutz Sexualisierte Gewalt
-- Quellen: UBSKM, BMFSFJ, KKG §4, SGB VIII §8a, Strafrecht §§174 ff. StGB
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF1',  'Definitionen und Formen sexualisierter Gewalt', 'WHO-Definition, Hands-on/Hands-off, organisierte Gewalt, Cybergrooming', 1),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF2',  'Rechtliche Grundlagen', 'StGB §§174-184k, §171, KKG §4, SGB VIII §8a, §72a', 2),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF3',  'Täterstrategien und Grooming', 'Phasen des Missbrauchs, Manipulation Kind/Familie/Institution', 3),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF4',  'Symptome, Folgen und Traumadynamik', 'PTBS, dissoziative Störungen, Bindungstrauma, Re-Inszenierung', 4),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF5',  'Anzeichen erkennen und Verdachtsabklärung', 'Vage Symptome, Verhaltenssignale, Handlungsleitfäden', 5),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF6',  'Gesprächsführung mit betroffenen Kindern', 'Aufdeckungsgespräche, suggestionsfreie Befragung, NICHD-Protokoll', 6),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF7',  'Schutzkonzepte in Institutionen', 'UBSKM-Standards, Risikoanalyse, Verhaltenskodex, Beschwerdeverfahren', 7),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF8',  'Multidisziplinäre Kooperation', 'Jugendamt, ISEF, Polizei, Staatsanwaltschaft, Beratungsstellen', 8),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF9',  'Strafverfahren und Opferschutz', 'StPO §§58a/255a, Nebenklage, psychosoziale Prozessbegleitung', 9),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF10', 'Intervention und Kinderschutz im Familienkontext', 'Innerfamiliärer Missbrauch, Geschwisterschutz, Wegweisung', 10),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF11', 'Sexualisierte Gewalt in digitalen Medien', 'Cybergrooming §176b StGB, Sextortion, Darstellungen §184b StGB', 11),
  ('cc1d59a8-0172-4a48-8688-4d43bdea375d', 'LF12', 'Selbstfürsorge, Sekundärtraumatisierung, Supervision', 'Vicarious Trauma, Burnout-Prävention, kollegiale Beratung', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'analyze', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Wissen', 'Fachwissen sicher abrufen'),
  (2, lf.code || '.2 Erkennen', 'Hinweise und Risiken erkennen'),
  (3, lf.code || '.3 Handeln', 'Schutzhandlungen durchführen'),
  (4, lf.code || '.4 Kooperieren', 'Mit Stellen rechtssicher kooperieren'),
  (5, lf.code || '.5 Reflektieren', 'Eigene Praxis reflektieren')
) AS c(idx, title, descr);

-- =====================================================================
-- KURS 7: Kinderschutzfachkraft (IseF) – §8a SGB VIII
-- Quellen: SGB VIII §§8a/8b, KKG §4, Bundesarbeitsgemeinschaft KSF, DIJuF
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF1',  'Rechtliche Grundlagen: SGB VIII §§8a/8b und KKG', 'Schutzauftrag, Beratungsanspruch, Vereinbarungen mit Trägern', 1),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF2',  'Definition und Formen von Kindeswohlgefährdung', 'Vernachlässigung, körperliche/seelische Misshandlung, sexualisierte Gewalt', 2),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF3',  'Rolle und Aufgaben der insoweit erfahrenen Fachkraft', 'Kollegiale Beratung, keine Fallübernahme, Dokumentation', 3),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF4',  'Risikoeinschätzung und Diagnoseinstrumente', 'Stuttgarter Kinderschutzbogen, Bogen zur Risikoeinschätzung', 4),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF5',  'Gefährdungseinschätzung im Team', 'Mehraugen-Prinzip, kollegiale Fallberatung, Hypothesenbildung', 5),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF6',  'Beteiligung von Kindern und Eltern', 'Hinwirkungsgebot, Schutz versus Beteiligung, Schweigepflicht', 6),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF7',  'Hilfeplanung und Schutzkonzepte', 'SGB VIII §36, Sicherheitsplan, Kontrollvereinbarungen', 7),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF8',  'Datenschutz und Schweigepflicht', 'StGB §203, SGB X, KKG §4 Abs. 3, Befugnisnormen', 8),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF9',  'Kooperation mit Jugendamt und Familiengericht', 'FamFG §157/§158, Inobhutnahme §42 SGB VIII', 9),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF10', 'Spezielle Fallkonstellationen', 'Frühkindliche Vernachlässigung, häusliche Gewalt, psychisch kranke Eltern', 10),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF11', 'Dokumentation und rechtssichere Berichte', 'Beratungsprotokoll, Verlaufsdokumentation, Gerichtsbericht', 11),
  ('3d8bd5bf-abc4-4564-ad9b-86d821250aa2', 'LF12', 'Qualitätsentwicklung, Supervision, Selbstfürsorge', 'Fortbildungspflicht, Intervision, Reflexion eigener Haltung', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'apply', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Rechtsrahmen', 'Anwendbare Rechtsnormen anwenden'),
  (2, lf.code || '.2 Einschätzung', 'Gefährdungslage einschätzen'),
  (3, lf.code || '.3 Beratung', 'Fachkräfte fundiert beraten'),
  (4, lf.code || '.4 Dokumentation', 'Beratungen rechtssicher dokumentieren'),
  (5, lf.code || '.5 Vernetzung', 'Mit Akteuren kooperieren')
) AS c(idx, title, descr);

-- =====================================================================
-- KURS 8: Umgangsbegleitung (Begleiteter Umgang)
-- Quellen: BGB §1684 Abs. 4, SGB VIII §18 Abs. 3, BAG Begleiteter Umgang, DIJuF
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF1',  'Rechtliche Grundlagen Begleiteter Umgang', 'BGB §1684 Abs. 4, FamFG §156, SGB VIII §18 Abs. 3', 1),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF2',  'Auftragsklärung und Indikation', 'Mitwirkungsbereiter Dritter, Schutzauftrag, Indikationskriterien', 2),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF3',  'Formen Begleiteten Umgangs', 'Kontrollierter, beschützender, unterstützender Umgang', 3),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF4',  'Bindungstheorie und Eltern-Kind-Beziehung', 'Bowlby/Ainsworth, sichere/unsichere Bindung, Bindungsstörungen', 4),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF5',  'Kontaktanbahnung und Kontaktaufbau', 'Vorgespräche, kindgerechte Vorbereitung, schrittweiser Aufbau', 5),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF6',  'Hochkonflikthafte Trennungs- und Scheidungsfamilien', 'Loyalitätskonflikte, Eskalationsdynamik, Konflikt-Coaching', 6),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF7',  'Schutzbedürfnisse und Sicherheitskonzepte', 'Häusliche Gewalt, Stalking, Entführungsrisiko, Schutzräume', 7),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF8',  'Beobachtung und Diagnostik der Eltern-Kind-Interaktion', 'Strukturierte Beobachtungsbögen, Marschak Interaction Method', 8),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF9',  'Kommunikation mit Eltern, Kindern und Bezugspersonen', 'Allparteilichkeit, Triangulierung vermeiden, kindgerechte Sprache', 9),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF10', 'Dokumentation und Berichterstattung an das Familiengericht', 'Verlaufsbericht, Empfehlungen, Abgrenzung zur Begutachtung', 10),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF11', 'Beendigung, Übergänge und Verselbständigung', 'Übergang zu unbegleitetem Umgang, Abbruchkriterien', 11),
  ('e4ed48be-4672-485b-b8bf-3eab4f8b3c44', 'LF12', 'Qualitätsstandards, Träger und Finanzierung', 'BAG-Standards, §36a SGB VIII, Honorierung, Versicherung', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'apply', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Rechtsgrundlage', 'Rechtsrahmen der Umgangsbegleitung anwenden'),
  (2, lf.code || '.2 Beziehungsarbeit', 'Beziehungen vertrauensvoll gestalten'),
  (3, lf.code || '.3 Beobachtung', 'Interaktionen systematisch beobachten'),
  (4, lf.code || '.4 Schutz', 'Schutzbedürfnisse sicherstellen'),
  (5, lf.code || '.5 Dokumentation', 'Verläufe rechtssicher dokumentieren')
) AS c(idx, title, descr);

-- =====================================================================
-- KURS 9: Umgangspfleger (BGB §1684 Abs. 3)
-- Quellen: BGB §1684 Abs. 3 i.V.m. §1909, FamFG, BdB-Standards Umgangspflegschaft
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF1',  'Rechtliche Grundlagen der Umgangspflegschaft', 'BGB §1684 Abs. 3, §1909, FamFG §151 Nr. 2/§156', 1),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF2',  'Bestellung, Aufgabenkreis und Vergütung', 'FamFG §158, VBVG, Stundenkontingent, Pflegerabrechnung', 2),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF3',  'Abgrenzung zu anderen Beistandschaften', 'Verfahrensbeistand, Ergänzungspflegschaft, Vormundschaft', 3),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF4',  'Hochkonflikthafte Familien und Eskalationsdynamik', 'Konfliktphasen nach Glasl, Kommunikationsblockaden', 4),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF5',  'Bindungstheorie und Kindeswohlkriterien', 'Bowlby, Bindungs-/Förder-/Kontinuitätsprinzip', 5),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF6',  'Umgangsregelung organisieren und durchsetzen', 'Aufenthaltsbestimmung Umgang, Übergaben, Transport', 6),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF7',  'Eltern-Kind-Entfremdung und induzierte Ablehnung', 'PAS-Diskussion, Gegenmaßnahmen, Bindungstoleranz', 7),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF8',  'Schutzkonzepte und Kindeswohlgefährdung', 'BGB §1666, §1684 Abs. 4, Aussetzung des Umgangs', 8),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF9',  'Kommunikation mit Eltern und Kindern', 'Allparteilichkeit, kindgerechte Kommunikation, Mediationselemente', 9),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF10', 'Kooperation mit Jugendamt, Gericht und Verfahrensbeistand', 'Rollenklärung, Berichterstattung, Anhörungen', 10),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF11', 'Berichterstellung und Beendigung der Pflegschaft', 'Tätigkeitsbericht, Abschlussbericht, Verlängerungsantrag', 11),
  ('d5428612-e734-40d3-86fb-d69e7dbbbec0', 'LF12', 'Qualitätssicherung, Haftung, Berufsethik', 'BdB-Standards, Berufshaftpflicht, Fortbildung, Supervision', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'apply', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Rechtsrahmen', 'Aufgabenkreis rechtssicher abgrenzen'),
  (2, lf.code || '.2 Konfliktarbeit', 'Eskalationsdynamiken bearbeiten'),
  (3, lf.code || '.3 Umsetzung', 'Umgang praktisch durchsetzen'),
  (4, lf.code || '.4 Kindeswohl', 'Kindeswohl absichern'),
  (5, lf.code || '.5 Berichterstattung', 'Gericht rechtssicher informieren')
) AS c(idx, title, descr);

-- =====================================================================
-- KURS 10: Verfahrenspflegschaft Betreuung (Erwachsenen-Verfahrenspflegschaft)
-- Quellen: FamFG §276 (Verfahrenspfleger), BtOG, BGB §§1814 ff., BdB
-- =====================================================================
WITH lf_inserts AS (
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF1',  'Rechtliche Grundlagen der Verfahrenspflegschaft', 'FamFG §276, §317 (Unterbringung), §419, BGB §1814 ff.', 1),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF2',  'Bestellung, Aufgaben, Vergütung', 'Erforderlichkeit (FamFG §276 Abs. 1), VBVG-Pauschalen Verfahrenspfleger', 2),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF3',  'Reform Vormundschafts- und Betreuungsrecht 2023', 'BtOG, Selbstbestimmung, Erforderlichkeit, Wunsch des Betroffenen', 3),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF4',  'Geschäftsfähigkeit, freier Wille, natürlicher Wille', 'BGB §104, §105 Abs. 2, BVerfG-Rechtsprechung Selbstbestimmung', 4),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF5',  'Krankheitsbilder und Behinderungsformen', 'Demenz, Psychose, Sucht, geistige Behinderung, Hirnschädigung', 5),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF6',  'Kommunikation mit Betroffenen', 'Leichte Sprache, validierende Kommunikation, Ressourcen aktivieren', 6),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF7',  'Betreuungsverfahren und Sachverhaltsermittlung', 'FamFG §§278/279, Anhörung, Sachverständigengutachten, Stellungnahme', 7),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF8',  'Unterbringung und freiheitsentziehende Maßnahmen', 'BGB §1831, FamFG §312 ff., zivilrechtliche und öffentlich-rechtliche Unterbringung', 8),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF9',  'Ärztliche Zwangsmaßnahmen und Einwilligungsvorbehalt', 'BGB §1832, §1825, BVerfG 2 BvR 882/09', 9),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF10', 'Vorrang anderer Hilfen, Vorsorgevollmacht, Patientenverfügung', 'BGB §1814 Abs. 3, §1827, Subsidiaritätsprinzip', 10),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF11', 'Rechtsmittel und Beschwerdeverfahren', 'FamFG §58 ff., Beschwerde, Rechtsbeschwerde, einstweilige Anordnung', 11),
  ('3be4c9af-0fe1-4c42-9352-3f3d0b3a743d', 'LF12', 'Berufsethik, Qualitätssicherung, Berufshaftpflicht', 'BdB-Standards, UN-Behindertenrechtskonvention, Supervision', 12)
  RETURNING id, code
)
INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, sort_order)
SELECT lf.id, lf.code || '.' || c.idx, c.title, c.descr, 'apply', c.idx FROM lf_inserts lf
CROSS JOIN LATERAL (VALUES
  (1, lf.code || '.1 Rechtsrahmen', 'Anwendbare Normen sicher anwenden'),
  (2, lf.code || '.2 Sachverhalt', 'Lebenslage und Wille erfassen'),
  (3, lf.code || '.3 Vertretung', 'Interessen rechtssicher vertreten'),
  (4, lf.code || '.4 Schutz', 'Grundrechte und Selbstbestimmung wahren'),
  (5, lf.code || '.5 Berichterstattung', 'Gericht qualifiziert informieren')
) AS c(idx, title, descr);

-- Audit log
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'reseed_curriculum_zertifikate_4_to_10_v1',
  'curriculum',
  jsonb_build_object(
    'curricula', jsonb_build_array(
      'fce1158a-caa6-4873-80aa-16fd8f016688',
      'ffb96610-25b8-4652-aa6b-3bad77bfce62',
      'cc1d59a8-0172-4a48-8688-4d43bdea375d',
      '3d8bd5bf-abc4-4564-ad9b-86d821250aa2',
      'e4ed48be-4672-485b-b8bf-3eab4f8b3c44',
      'd5428612-e734-40d3-86fb-d69e7dbbbec0',
      '3be4c9af-0fe1-4c42-9352-3f3d0b3a743d'
    ),
    'lfs_per_curriculum', 12,
    'comps_per_lf', 5,
    'sources', 'BdB, AGT, BAG, BVEB, UBSKM, BGB, FamFG, SGB VIII, KKG, BtOG, ErbStG, StGB'
  )
);
