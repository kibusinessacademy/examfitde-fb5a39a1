
DELETE FROM lessons WHERE module_id IN (SELECT id FROM modules WHERE course_id = '5438997b-8a20-4e61-8628-7a5526195ad9');
DELETE FROM modules WHERE course_id = '5438997b-8a20-4e61-8628-7a5526195ad9';
DELETE FROM handbook_sections WHERE chapter_id IN (SELECT id FROM handbook_chapters WHERE curriculum_id = 'd95c085b-7a4d-49af-8ef3-046b1f9e53e9');
DELETE FROM handbook_chapters WHERE curriculum_id = 'd95c085b-7a4d-49af-8ef3-046b1f9e53e9';
DELETE FROM exam_blueprints WHERE curriculum_id = 'd95c085b-7a4d-49af-8ef3-046b1f9e53e9';
DELETE FROM competencies WHERE learning_field_id IN (SELECT id FROM learning_fields WHERE curriculum_id = 'd95c085b-7a4d-49af-8ef3-046b1f9e53e9');
DELETE FROM learning_fields WHERE curriculum_id = 'd95c085b-7a4d-49af-8ef3-046b1f9e53e9';

INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order, weight_percent, hours) VALUES
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF1', 'Rechtliche Grundlagen Kindschaftsrecht', 'BGB, FamFG §§151-159, KJHG/SGB VIII, internationales Familienrecht (HKÜ, Brüssel IIb)', 1, 12, 24),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF2', 'Verfahrensbeistandschaft – Rolle, Aufgaben, Standards', 'FamFG §158-158c, BAG-Mindeststandards, Abgrenzung zu Sachverständigen, Vormund, Umgangspfleger', 2, 10, 20),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF3', 'Kindeswohl und Kindeswille', 'BGH-Rechtsprechung, Kindeswohlkriterien (Dettenborn), Bindung, Kontinuität, Förderung, Wille des Kindes', 3, 10, 20),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF4', 'Entwicklungspsychologie Kinder & Jugendliche', 'Bindungstheorie (Bowlby/Ainsworth), Entwicklungsphasen 0-18, Resilienz, Trauma-Folgen', 4, 8, 16),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF5', 'Kindeswohlgefährdung & Kinderschutz', 'BGB §1666, §8a SGB VIII, Risikoeinschätzung, Häusliche Gewalt, Vernachlässigung, sex. Missbrauch', 5, 10, 20),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF6', 'Trennung, Scheidung, Hochkonflikt', 'PAS-Debatte, Hochstrittigkeit, Loyalitätskonflikte, Cochemer Modell, Mediation', 6, 8, 16),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF7', 'Gesprächsführung mit Kindern (kindgerecht)', 'Altersgerechte Kommunikation, narrative Interviewtechnik, Suggestivvermeidung, Anwesenheitsgespräche', 7, 10, 20),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF8', 'Familiengerichtliches Verfahren in der Praxis', 'Antragsverfahren, mündliche Verhandlung, Anhörung Minderjähriger §159 FamFG, Beschwerde', 8, 8, 16),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF9', 'Schriftliche Berichterstattung & Stellungnahmen', 'Strukturierter Bericht, Trennung Wahrnehmung/Bewertung, Empfehlung, Aktenführung', 9, 8, 16),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF10', 'Kooperation im Helfersystem', 'Jugendamt, Sachverständige, Kita/Schule, Therapeuten, Schweigepflicht §203 StGB', 10, 6, 12),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF11', 'Berufsethik, Selbstreflexion & Supervision', 'Allparteilichkeit, Rollenklarheit, Sekundärtraumatisierung, Burnout-Prävention, BAG-Ethik-Kodex', 11, 5, 10),
  ('d95c085b-7a4d-49af-8ef3-046b1f9e53e9', 'LF12', 'Vergütung, Qualifikation & Akquise', 'JVEG §158c, Bestellungsverfahren, Qualifikationsnachweis, Marketing als Verfahrensbeistand', 12, 5, 10);

INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, exam_relevance_tier, sort_order)
SELECT lf.id, comp.code, comp.title, comp.description, comp.tax_level, comp.tier, comp.sort_order
FROM learning_fields lf
JOIN (VALUES
  ('LF1','LF1.1','Familienrechtliche Grundnormen','BGB §§1626-1698b: Elterliche Sorge, Sorgerecht, Vertretung','remember','core',1),
  ('LF1','LF1.2','FamFG Verfahrensvorschriften','§§151-159 FamFG: Kindschaftssachen, Beteiligte, Anhörung','understand','core',2),
  ('LF1','LF1.3','KJHG/SGB VIII im Verfahren','§§8a, 8b, 50 SGB VIII: Mitwirkung Jugendamt, Schutzauftrag','apply','core',3),
  ('LF1','LF1.4','Internationales Familienrecht','HKÜ, Brüssel IIb-VO, Kindesentziehung grenzüberschreitend','apply','supplementary',4),
  ('LF1','LF1.5','Aktuelle Rechtsprechung BGH/EGMR','Leitentscheidungen Sorge-/Umgangsrecht 2020-2024','analyze','important',5),
  ('LF2','LF2.1','Bestellungsvoraussetzungen §158 FamFG','Erforderlichkeit, Pflichtbestellung, Aufgabenkreis','understand','core',1),
  ('LF2','LF2.2','Aufgabenkatalog §158b FamFG','Interesse Kind feststellen, geltend machen, Kind informieren','apply','core',2),
  ('LF2','LF2.3','BAG-Mindeststandards','Qualifikation, Fortbildung, Caseload, Erreichbarkeit','remember','core',3),
  ('LF2','LF2.4','Abgrenzung zu anderen Akteuren','Sachverständiger, Vormund, Umgangspfleger, Anwalt','analyze','core',4),
  ('LF2','LF2.5','Erweiterter Aufgabenkreis','§158b Abs.2: Vergleichsgespräche, Umgangsregelung','apply','supplementary',5),
  ('LF3','LF3.1','Kindeswohlkriterien nach Dettenborn','Förderprinzip, Kontinuität, Bindung, Wille','understand','core',1),
  ('LF3','LF3.2','BGH-Rechtsprechung Kindeswohl','Leitsätze zu Sorgerecht, Wechselmodell, Umgang','analyze','core',2),
  ('LF3','LF3.3','Kindeswille altersabhängig erfassen','Autonomie, Stabilität, Intensität, Zielorientierung','apply','core',3),
  ('LF3','LF3.4','Kindeswille vs. Kindeswohl','Konflikt, Manipulation, autonomer Wille','evaluate','core',4),
  ('LF3','LF3.5','Wechselmodell-Voraussetzungen','Kommunikationsfähigkeit, Wohnortnähe, Kindeswille','evaluate','supplementary',5),
  ('LF4','LF4.1','Bindungstheorie Bowlby/Ainsworth','Sichere/unsichere Bindung, Bindungspersonen','understand','core',1),
  ('LF4','LF4.2','Entwicklungsphasen 0-18 Jahre','Piaget, Erikson, kognitive/emotionale Meilensteine','remember','core',2),
  ('LF4','LF4.3','Trauma & Folgen für Kinder','Typ-I/II Trauma, Bindungstrauma, PTBS Symptome','understand','core',3),
  ('LF4','LF4.4','Resilienzfaktoren','Schutzfaktoren, Risikofaktoren, Mentalisierung','apply','important',4),
  ('LF4','LF4.5','Loyalitätskonflikte verstehen','Triangulierung, Parentifizierung, Splitting','analyze','core',5),
  ('LF5','LF5.1','Tatbestand §1666 BGB','Gefährdung körperlich, geistig, seelisch, Vermögen','understand','core',1),
  ('LF5','LF5.2','Schutzauftrag §8a SGB VIII','Gewichtige Anhaltspunkte, Risikoeinschätzung','apply','core',2),
  ('LF5','LF5.3','Erscheinungsformen Vernachlässigung','Körperliche, emotionale, erzieherische, medizinische','analyze','core',3),
  ('LF5','LF5.4','Häusliche Gewalt & Kinder','Miterleben als KWG, GewSchG, Umgangsausschluss','evaluate','core',4),
  ('LF5','LF5.5','Sexueller Missbrauch erkennen','Indikatoren, Aussagepsychologie, Verfahrensumgang','analyze','core',5),
  ('LF6','LF6.1','Hochstrittigkeit Definition & Dynamik','Eskalationsstufen Glasl, Konfliktmuster','understand','core',1),
  ('LF6','LF6.2','PAS-Debatte kritisch einordnen','Wissenschaftlicher Stand, Kontaktverweigerung','evaluate','important',2),
  ('LF6','LF6.3','Cochemer Modell & Praxis','Interdisziplinäre Frühintervention, Beschleunigung','apply','core',3),
  ('LF6','LF6.4','Mediation & Beratung anregen','Begleiteter Umgang, Familienberatung §28 SGB VIII','apply','core',4),
  ('LF6','LF6.5','Umgang mit Loyalitätskonflikten','Kindzentrierte Intervention, Schutz vor Instrumentalisierung','apply','supplementary',5),
  ('LF7','LF7.1','Altersgerechte Kommunikation','Sprache, Symbole, Spielmaterial nach Altersstufe','apply','core',1),
  ('LF7','LF7.2','Narrative Interviewtechnik','Offene Fragen, freier Bericht, Trichtertechnik','apply','core',2),
  ('LF7','LF7.3','Suggestivfragen vermeiden','Aussagepsychologische Standards, neutrale Exploration','evaluate','core',3),
  ('LF7','LF7.4','Erstkontakt & Vertrauensaufbau','Setting, Aufklärung Rolle, Schweigepflicht','apply','core',4),
  ('LF7','LF7.5','Gespräche mit Eltern führen','Allparteilich, deeskalierend, lösungsorientiert','apply','core',5),
  ('LF8','LF8.1','Verfahrensablauf Sorgerechtssache','Antrag, Anhörung, Beweisaufnahme, Beschluss','understand','core',1),
  ('LF8','LF8.2','Anhörung Minderjähriger §159 FamFG','Pflichtanhörung, Setting, Gericht-Verfahrensbeistand-Rollen','apply','core',2),
  ('LF8','LF8.3','Mündliche Verhandlung & Vergleich','Erörterungstermin, einvernehmliche Lösung §156 FamFG','apply','core',3),
  ('LF8','LF8.4','Einstweilige Anordnung','§49 FamFG, dringender Schutzbedarf, Verfahren','apply','core',4),
  ('LF8','LF8.5','Beschwerde & Rechtsmittel','§58 FamFG, Beschwerdeberechtigung Verfahrensbeistand','understand','supplementary',5),
  ('LF9','LF9.1','Berichtsstruktur BAG-konform','Auftrag, Vorgehen, Wahrnehmungen, Bewertung, Empfehlung','apply','core',1),
  ('LF9','LF9.2','Trennung Tatsache & Bewertung','Wahrnehmungsebene vs. fachliche Einschätzung','evaluate','core',2),
  ('LF9','LF9.3','Empfehlungen begründen','Kindeswohlbezug, Alternativen, Prognose','create','core',3),
  ('LF9','LF9.4','Aktenführung & Datenschutz','DSGVO, Aufbewahrung, Akteneinsicht §13 FamFG','apply','core',4),
  ('LF9','LF9.5','Mündlicher Vortrag im Termin','Strukturierte Stellungnahme, Reaktion auf Einwände','apply','supplementary',5),
  ('LF10','LF10.1','Zusammenarbeit Jugendamt','ASD, Hilfeplanung §36 SGB VIII, §50-Bericht','apply','core',1),
  ('LF10','LF10.2','Kooperation mit Sachverständigen','Abgrenzung Aufgaben, Informationsaustausch','understand','core',2),
  ('LF10','LF10.3','Schulen, Kitas, Therapeuten','Schweigepflichtsentbindung, kontextspezifische Anfragen','apply','important',3),
  ('LF10','LF10.4','Schweigepflicht §203 StGB','Anvertrauen, Befugnis, rechtfertigender Notstand §34 StGB','analyze','core',4),
  ('LF10','LF10.5','Interdisziplinäre Fallkonferenzen','Cochemer Praxis, Helferkonferenz, Moderation','apply','supplementary',5),
  ('LF11','LF11.1','Allparteilichkeit & Rollenklarheit','Anwalt des Kindes vs. Anwalt des Kindeswillens','understand','core',1),
  ('LF11','LF11.2','Selbstreflexion eigener Werte','Übertragung, Gegenübertragung, blinde Flecken','evaluate','important',2),
  ('LF11','LF11.3','Sekundärtraumatisierung & Selbstfürsorge','Symptome, Prävention, Burnout-Frühindikatoren','apply','core',3),
  ('LF11','LF11.4','Supervision & Intervision','Fall-/Team-/Lehrsupervision, kollegiale Beratung','apply','important',4),
  ('LF11','LF11.5','BAG-Ethik-Kodex anwenden','Verschwiegenheit, Unabhängigkeit, Fortbildungspflicht','evaluate','core',5),
  ('LF12','LF12.1','Vergütung §158c FamFG','Pauschalvergütung 350/550€, Mehraufgaben','remember','core',1),
  ('LF12','LF12.2','JVEG ergänzende Regelungen','Auslagen, Reisekosten, Mehrwertsteuer','apply','core',2),
  ('LF12','LF12.3','Qualifikationsnachweis BAG','Grundqualifikation, jährliche Fortbildung 25h','remember','core',3),
  ('LF12','LF12.4','Bestellungspraxis Familiengerichte','Listenführung, regionale Unterschiede, Akquise','apply','supplementary',4),
  ('LF12','LF12.5','Selbstständigkeit & Steuerrecht','Freiberuflichkeit, Einkommensteuer, Versicherungen','understand','supplementary',5)
) AS comp(lf_code, code, title, description, tax_level, tier, sort_order)
ON lf.code = comp.lf_code
WHERE lf.curriculum_id = 'd95c085b-7a4d-49af-8ef3-046b1f9e53e9';

INSERT INTO admin_actions (action, scope, payload) VALUES (
  'reseed_curriculum_verfahrensbeistand_v1',
  'curriculum:d95c085b-7a4d-49af-8ef3-046b1f9e53e9',
  jsonb_build_object('standard','BAG + Weinsberger + FamFG','learning_fields',12,'competencies',60,'package_id','7472b96f-22ed-493f-9aca-74e70ebcaf8e')
);
