-- Cleanup aller FK-Referenzen
DELETE FROM lessons WHERE competency_id IN (SELECT c.id FROM competencies c JOIN learning_fields lf ON c.learning_field_id=lf.id WHERE lf.curriculum_id='4e17f28d-c118-439d-9b43-4c3a96d520ab');
DELETE FROM handbook_sections WHERE competency_id IN (SELECT c.id FROM competencies c JOIN learning_fields lf ON c.learning_field_id=lf.id WHERE lf.curriculum_id='4e17f28d-c118-439d-9b43-4c3a96d520ab');
UPDATE modules SET learning_field_id=NULL WHERE learning_field_id IN (SELECT id FROM learning_fields WHERE curriculum_id='4e17f28d-c118-439d-9b43-4c3a96d520ab');
DELETE FROM competencies WHERE learning_field_id IN (SELECT id FROM learning_fields WHERE curriculum_id='4e17f28d-c118-439d-9b43-4c3a96d520ab');
DELETE FROM learning_fields WHERE curriculum_id='4e17f28d-c118-439d-9b43-4c3a96d520ab';

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf1', 'Betreuerbestellung & Zusammenarbeit mit dem Betreuungsgericht', 'Materielle und verfahrensrechtliche Grundlagen der Betreuerbestellung.', 1) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf1-k1', 'Voraussetzungen der Betreuerbestellung nach §§ 1814 ff. BGB prüfen', 'Materiell-rechtliche Voraussetzungen gemäß § 1814 BGB (Krankheit/Behinderung, Erforderlichkeit, Subsidiarität).', 1),
  ('lf1-k2', 'Verfahren der Betreuerbestellung nach FamFG durchführen', 'Ablauf nach §§ 271 ff. FamFG inkl. persönlicher Anhörung (§ 278) und Sachverständigengutachten (§ 280).', 2),
  ('lf1-k3', 'Aufgabenkreise und Betreuerauswahl nach §§ 1815, 1816 BGB', 'Festlegung der Aufgabenkreise und Auswahlkriterien beurteilen.', 3),
  ('lf1-k4', 'Berichts- und Rechenschaftspflichten nach §§ 1863, 1865 BGB', 'Anfangs-/Jahresbericht und Rechnungslegung gewährleisten.', 4),
  ('lf1-k5', 'Aufhebung, Erweiterung, Beendigung der Betreuung (§§ 1870 ff. BGB)', 'Voraussetzungen prüfen; Verfahren einleiten.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf2', 'Betreuungsführung (UN-BRK Art. 12, § 1821 BGB)', 'Grundprinzipien der Betreuungsführung nach UN-BRK und § 1821 BGB.', 2) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf2-k1', 'Grundpflichten der Betreuungsführung nach § 1821 BGB anwenden', 'Wünsche des Betreuten als Maßstab; Besprechungspflicht.', 1),
  ('lf2-k2', 'Unterstützte Entscheidungsfindung nach Art. 12 UN-BRK praktizieren', 'Abgrenzung zur stellvertretenden Entscheidung.', 2),
  ('lf2-k3', 'Wunschermittlung bei nicht einwilligungsfähigen Personen', 'Mutmaßlichen Willen (§ 1821 Abs. 3) systematisch ermitteln.', 3),
  ('lf2-k4', 'Einwilligungsvorbehalt nach § 1825 BGB', 'Voraussetzungen und Reichweite beurteilen.', 4),
  ('lf2-k5', 'Rechtssichere Dokumentation der Betreuungsführung', 'Rechenschaftspflicht (§ 1863) und Haftungsabsicherung.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf3', 'Unterbringung & ärztliche Zwangsmaßnahmen', 'Freiheitsentziehende Unterbringung und Zwangsmaßnahmen.', 3) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf3-k1', 'Voraussetzungen der Unterbringung nach § 1831 BGB prüfen', 'Tatbestandsvoraussetzungen; Abgrenzung zu PsychKG.', 1),
  ('lf3-k2', 'Verfahren nach §§ 312 ff. FamFG managen', 'Genehmigungsverfahren beantragen; Verfahrensgarantien sicherstellen.', 2),
  ('lf3-k3', 'Ärztliche Zwangsmaßnahme nach § 1832 BGB', 'Enge Voraussetzungen prüfen; Ultima-Ratio-Funktion.', 3),
  ('lf3-k4', 'Unterbringungsähnliche Maßnahmen nach § 1831 Abs. 4 BGB', 'Bettgitter, Fixierungen als genehmigungspflichtig identifizieren.', 4),
  ('lf3-k5', 'Rechte des Betreuten während freiheitsentziehender Maßnahmen', 'Verhältnismäßigkeit und regelmäßige Überprüfung.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf4', 'Personensorge 1 – Krankheits- und Behinderungsbilder', 'Betreuungsrelevante psychische und physische Krankheits-/Behinderungsbilder.', 4) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf4-k1', 'Psychische Erkrankungen (Schizophrenie, Depression)', 'Symptome, Verlauf, Auswirkungen auf Einwilligungsfähigkeit.', 1),
  ('lf4-k2', 'Demenzielle Erkrankungen und kognitive Störungen', 'Demenzformen unterscheiden; Beeinträchtigung einschätzen.', 2),
  ('lf4-k3', 'Suchterkrankungen', 'Folgen erkennen; Suchthilfesystem nutzen.', 3),
  ('lf4-k4', 'Geistige und körperliche Behinderungen', 'Auswirkungen auf Lebensführung; UN-BRK-konforme Unterstützung.', 4),
  ('lf4-k5', 'ICD-10 und ICF als Klassifikationssysteme', 'Befunde und Gutachten korrekt einordnen.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf5', 'Personensorge 2 – Behandlungsvertrag, Patientenverfügung, Wohnraum', 'Gesundheitsfürsorge und Wohnungsangelegenheiten.', 5) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf5-k1', 'Behandlungsvertrag (§§ 630a ff. BGB)', 'Stellvertretender Vertragsschluss; Einwilligung erteilen.', 1),
  ('lf5-k2', 'Patientenverfügung und Vorsorgevollmacht (§§ 1827, 1820 BGB)', 'Wirksamkeit prüfen; Willen durchsetzen.', 2),
  ('lf5-k3', 'Genehmigungspflichtige Maßnahmen (§§ 1829, 1830 BGB)', 'Lebensgefahr/Sterilisation: Verfahren einleiten.', 3),
  ('lf5-k4', 'Aufgabe von Wohnraum (§ 1833 BGB)', 'Genehmigung; Mitteilungspflichten bei Wohnungsverlust.', 4),
  ('lf5-k5', 'Aufenthaltsbestimmung und Umgangsrecht', 'Aufenthalt und Umgang zum Wohl des Betreuten regeln.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf6', 'Vermögenssorge 1 – Geschäftsfähigkeit, Schuldrecht, Insolvenz', 'Zivilrechtliche Grundlagen der Vermögenssorge.', 6) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf6-k1', 'Geschäftsfähigkeit und Stellvertretung (§§ 104 ff., 164 ff. BGB)', 'Geschäfts(un)fähigkeit beurteilen; gesetzlicher Vertreter.', 1),
  ('lf6-k2', 'Allgemeines Schuldrecht und Vertragsgestaltung', 'Verträge prüfen und gestalten.', 2),
  ('lf6-k3', 'Schuldenregulierung und Vergleich', 'Mit Gläubigern verhandeln; Vergleiche schließen.', 3),
  ('lf6-k4', 'Mahn- und Vollstreckungsverfahren abwehren', 'Widerspruch (§ 694 ZPO); P-Konto (§ 850k ZPO).', 4),
  ('lf6-k5', 'Verbraucherinsolvenz (§§ 304 ff. InsO)', 'Restschuldbefreiung; Wohlverhaltensperiode begleiten.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf7', 'Vermögenssorge 2 – Vermögensverwaltung, Miet-, Erb-, Familienrecht', 'Laufende Verwaltung und Querschnittsbereiche.', 7) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf7-k1', 'Vermögensverwaltung und -anlage (§§ 1835 ff. BGB)', 'Vermögensverzeichnis; sichere Anlage.', 1),
  ('lf7-k2', 'Genehmigungserfordernisse (§§ 1848 ff. BGB)', 'Grundstücke (§ 1850), Erbausschlagung (§ 1851) beantragen.', 2),
  ('lf7-k3', 'Mietrechtliche Angelegenheiten managen', 'Vermieterpflichten wahrnehmen.', 3),
  ('lf7-k4', 'Erbrecht und Handeln als Erbe', 'Annahme/Ausschlagung; Erbschein; Auseinandersetzung.', 4),
  ('lf7-k5', 'Familienrecht (Unterhalt, Scheidung)', 'Unterhalt prüfen; Rolle in Scheidung.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf8', 'Sozialrecht 1 – SGB-Überblick (II, V, VI, XI, XII)', 'Zentrale SGB; Existenzsicherung und Gesundheit.', 8) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf8-k1', 'Lebensunterhalt nach SGB II und SGB XII', 'Bürgergeld und Sozialhilfe abgrenzen; Leistungen beantragen.', 1),
  ('lf8-k2', 'Krankenversicherung (SGB V)', 'Krankengeld, häusliche Krankenpflege, Hilfsmittel.', 2),
  ('lf8-k3', 'Rentenversicherung (SGB VI)', 'Renten- und Reha-Anträge.', 3),
  ('lf8-k4', 'Pflegeversicherung (SGB XI)', 'Pflegegrad; Leistungen kombinieren.', 4),
  ('lf8-k5', 'Antrags-, Widerspruchs- und Klageverfahren', 'Fristen; Sozialgerichtsklage einschätzen.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf9', 'Sozialrecht 2 – SGB IX/BTHG, Teilhabe, Pflege', 'Rehabilitation und Teilhabe nach SGB IX/BTHG.', 9) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf9-k1', 'Grundprinzipien SGB IX und BTHG', 'Personenzentrierung; Trennung Fach-/Existenzleistungen.', 1),
  ('lf9-k2', 'Gesamtplanverfahren (§§ 117 ff. SGB IX)', 'Konferenz initiieren und begleiten.', 2),
  ('lf9-k3', 'Eingliederungshilfe (§§ 90 ff. SGB IX)', 'Soziale Teilhabe, Assistenz, Arbeitsleben.', 3),
  ('lf9-k4', 'Persönliches Budget (§ 29 SGB IX)', 'Beantragen; Betreuten als Arbeitgeber unterstützen.', 4),
  ('lf9-k5', 'Schnittstellen SGB IX/XI/XII koordinieren', 'Antrag beim leistenden Reha-Träger (§ 14 SGB IX).', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf10', 'Grundlagen der Kommunikation & Praxistransfer', 'Beziehung, Konflikt, Netzwerk.', 10) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf10-k1', 'Gesprächsführung und aktives Zuhören', 'Paraphrasieren, Ich-Botschaften.', 1),
  ('lf10-k2', 'Professionelle Beziehungsgestaltung: Nähe und Distanz', 'Rollenverständnis und Distanz wahren.', 2),
  ('lf10-k3', 'Konfliktmanagement', 'Deeskalation; zwischen Interessen vermitteln.', 3),
  ('lf10-k4', 'Netzwerkarbeit und Kooperation', 'Ärzte, Pflege, Behörden vernetzen.', 4),
  ('lf10-k5', 'Selbstfürsorge und Burnout-Prävention', 'Psychohygiene und kollegiale Beratung.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf11', 'Unterstützte Entscheidungsfindung & barrierefreie Kommunikation', 'Spezialisierung gemäß § 1821 BGB und UN-BRK.', 11) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf11-k1', 'Methoden der Unterstützten Entscheidungsfindung', 'Einfache Sprache, Visualisierung von Konsequenzen.', 1),
  ('lf11-k2', 'Barrierefreie Kommunikation (Leichte Sprache, UK)', 'Unterstützte Kommunikation für komplexe Bedürfnisse.', 2),
  ('lf11-k3', 'Willen nicht/kaum sprechender Menschen ermitteln', 'Nonverbale Signale; Kooperation mit Bezugspersonen.', 3),
  ('lf11-k4', 'Ambivalente und manipulierte Wünsche', 'Authentischen Willen nach § 1821 BGB schützen.', 4),
  ('lf11-k5', 'Ethische Dilemmata reflektieren', 'Wille vs. objektives Wohl systematisch entscheiden.', 5)
) AS v(code, title, descr, so);

WITH lf_ins AS (INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order) VALUES ('4e17f28d-c118-439d-9b43-4c3a96d520ab', 'lf12', 'Berufsbild, Berufsethik, Büroorganisation & Reflexion', 'Berufspraktische und ethische Rahmenbedingungen.', 12) RETURNING id)
INSERT INTO competencies (learning_field_id, code, title, description, sort_order) SELECT lf_ins.id, v.code, v.title, v.descr, v.so FROM lf_ins, (VALUES
  ('lf12-k1', 'Berufsbild und Berufsrecht (BtOG, VBVG)', 'Registrierungsvoraussetzungen; Fortbildungspflicht.', 1),
  ('lf12-k2', 'Berufsethische Grundsätze (BdB-Standards)', 'Autonomie, Würde, Interessenkonflikte.', 2),
  ('lf12-k3', 'Büroorganisation und Dokumentenmanagement', 'Aktenführung, DSGVO, Betreuungssoftware.', 3),
  ('lf12-k4', 'Haftung (§ 1826 BGB) und Versicherungen', 'Berufshaftpflicht nach § 23 Abs. 1 Nr. 3 BtOG.', 4),
  ('lf12-k5', 'Vergütung nach VBVG abrechnen', 'Fallpauschalen; Anträge form-/fristgerecht.', 5)
) AS v(code, title, descr, so);

INSERT INTO admin_actions (action, scope, payload, user_id)
VALUES ('reseed_curriculum_betreuer_v1', 'curriculum_curation',
  jsonb_build_object('curriculum_id','4e17f28d-c118-439d-9b43-4c3a96d520ab','package_id','3f416f2f-4364-460c-8924-caa2316a12d0','sources', jsonb_build_array('BdB 11 Schlüsselkompetenzen','Weinsberger Forum'),'learning_fields', 12,'competencies', 60),
  'b0dbd616-9b93-47c8-83c5-39290130a6ea');