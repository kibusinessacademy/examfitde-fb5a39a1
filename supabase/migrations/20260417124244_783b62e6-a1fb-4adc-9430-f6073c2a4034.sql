DO $$
DECLARE
  v_curr uuid := '500cf9f9-e89b-4152-844d-612c6f365400';
  v_pkg  uuid := 'e72f7008-3007-4b9c-b0b4-2a73d8e865e5';
  v_lf_id uuid;
BEGIN
  DELETE FROM blueprint_targets WHERE competency_id IN (
    SELECT co.id FROM competencies co JOIN learning_fields lf ON lf.id=co.learning_field_id WHERE lf.curriculum_id=v_curr
  );
  DELETE FROM exam_questions WHERE curriculum_id=v_curr;
  DELETE FROM exam_blueprints WHERE curriculum_id=v_curr;
  DELETE FROM handbook_sections WHERE chapter_id IN (SELECT id FROM handbook_chapters WHERE curriculum_id=v_curr);
  DELETE FROM handbook_chapters WHERE curriculum_id=v_curr;
  DELETE FROM competencies WHERE learning_field_id IN (SELECT id FROM learning_fields WHERE curriculum_id=v_curr);
  DELETE FROM learning_fields WHERE curriculum_id=v_curr;

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP01', 'Rechtsgrundlagen der Nachlasspflegschaft',
          'BGB §§1960-1962, FamFG §§342-345, Verhältnis zum Vormundschaftsrecht (BGB §§1773ff)', 1, 12)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP01.1', 'Voraussetzungen der Anordnung (§ 1960 BGB)', 'Sicherungsbedürfnis, unbekannte/ungewisse Erben, Erbschaft noch nicht angenommen', 'apply', 'apply', 1, 'core'),
  (v_lf_id, 'NP01.2', 'Wirkungskreise des Nachlasspflegers', 'Sicherung, Verwaltung, Erbenermittlung – Festlegung im Bestellungsbeschluss', 'understand', 'understand', 2, 'core'),
  (v_lf_id, 'NP01.3', 'Abgrenzung Testamentsvollstreckung & Nachlassverwaltung', 'Funktionsunterschiede und Kollisionsfälle', 'analyze', 'analyze', 3, 'important'),
  (v_lf_id, 'NP01.4', 'Verfahren vor dem Nachlassgericht (FamFG §§342ff)', 'Zuständigkeit, Verfahrensgang, Bestellungsbeschluss', 'apply', 'apply', 4, 'core'),
  (v_lf_id, 'NP01.5', 'Reichweite gerichtlicher Genehmigungen', 'Genehmigungspflichtige Geschäfte (§§1821, 1822 i.V.m. §1915 BGB)', 'apply', 'apply', 5, 'core');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP02', 'Fallübernahme und Nachlasssicherung',
          'Erste Schritte nach Bestellung: Wohnungsöffnung, Sicherstellung Wertgegenstände, Postaufträge, Behördenkontakte', 2, 10)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP02.1', 'Sofortmaßnahmen nach Bestellung', 'Wohnungsöffnung, Schlüsselsicherung, Bestandsaufnahme', 'apply', 'apply', 1, 'core'),
  (v_lf_id, 'NP02.2', 'Sicherung beweglicher Wertgegenstände', 'Bargeld, Schmuck, Wertpapiere – Verwahrung und Verwertung', 'apply', 'apply', 2, 'important'),
  (v_lf_id, 'NP02.3', 'Anschreiben Beteiligter und Standardgläubiger', 'GEZ, Telekom, Rente, Sozialleistungsträger', 'apply', 'apply', 3, 'important'),
  (v_lf_id, 'NP02.4', 'Postnachsendung und Aktenführung', 'Antrag bei Deutscher Post, geordnete Pflegschaftsakte', 'apply', 'apply', 4, 'supplementary'),
  (v_lf_id, 'NP02.5', 'Bestattung und Grabpflege', 'Anordnung, Kosten, Zuständigkeit, Sozialhilfeträger', 'apply', 'apply', 5, 'important');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP03', 'Vermögensverzeichnis und Wertermittlung',
          'BGB §1802, §1915 – Aufstellung, Bewertung, Vorlage beim Nachlassgericht', 3, 8)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP03.1', 'Erstellung des Vermögensverzeichnisses', 'Aktiva/Passiva, Stichtag, Vollständigkeit', 'apply', 'apply', 1, 'core'),
  (v_lf_id, 'NP03.2', 'Bewertung von Immobilien', 'Verkehrswert, Sachverständigengutachten, Belastungen', 'analyze', 'analyze', 2, 'important'),
  (v_lf_id, 'NP03.3', 'Bewertung beweglicher Sachen und Hausrat', 'Auflösungswert vs. Verkehrswert', 'apply', 'apply', 3, 'supplementary'),
  (v_lf_id, 'NP03.4', 'Forderungen und Verbindlichkeiten erfassen', 'Bankkonten, Versicherungen, offene Rechnungen', 'apply', 'apply', 4, 'important'),
  (v_lf_id, 'NP03.5', 'Vorlagepflichten beim Nachlassgericht', 'Form, Frist, Korrekturen', 'remember', 'remember', 5, 'core');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP04', 'Erbenermittlung',
          'Genealogische Recherche, Standesämter, Auslandsermittlung, gewerbliche Erbenermittler', 4, 10)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP04.1', 'Gesetzliche Erbfolge (BGB §§1924-1931)', 'Ordnungen, Stamm, Repräsentation, Eintrittsrecht', 'apply', 'apply', 1, 'core'),
  (v_lf_id, 'NP04.2', 'Recherche bei Standesämtern und Archiven', 'Personenstandsregister, Kirchenbücher, Auskunftsersuchen', 'apply', 'apply', 2, 'important'),
  (v_lf_id, 'NP04.3', 'Auslandsermittlung', 'Konsulate, ausländische Register, Apostille', 'analyze', 'analyze', 3, 'supplementary'),
  (v_lf_id, 'NP04.4', 'Beauftragung gewerblicher Erbenermittler', 'Honorarvereinbarung, Genehmigung, Risiken', 'evaluate', 'evaluate', 4, 'important'),
  (v_lf_id, 'NP04.5', 'Aufgebot unbekannter Erben (§ 1965 BGB)', 'Voraussetzungen, Verfahren, Wirkungen', 'apply', 'apply', 5, 'core');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP05', 'Verwaltung vermögender Nachlässe',
          'Bankverbindungen, Mietverhältnisse, Wohnungsauflösung, laufende Geschäfte', 5, 10)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP05.1', 'Bankkonten und Wertpapierdepots', 'Verfügungsbefugnis nachweisen, Kontenverwaltung', 'apply', 'apply', 1, 'core'),
  (v_lf_id, 'NP05.2', 'Beendigung Mietverhältnis', 'Kündigung, Räumung, Übergabeprotokoll', 'apply', 'apply', 2, 'core'),
  (v_lf_id, 'NP05.3', 'Wohnungsauflösung & Hausratverwertung', 'Verkauf, Spende, Entsorgung – Genehmigungserfordernis', 'apply', 'apply', 3, 'important'),
  (v_lf_id, 'NP05.4', 'Immobilienverwaltung und -verkauf', 'Mieteinnahmen, Bewirtschaftung, Verkauf mit gerichtlicher Genehmigung', 'analyze', 'analyze', 4, 'important'),
  (v_lf_id, 'NP05.5', 'Erbschein für den Nachlasspfleger', 'Antrag, Bedeutung, Kosten', 'understand', 'understand', 5, 'supplementary');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP06', 'Überschuldeter Nachlass',
          'Nachlassinsolvenz (InsO §§315ff), Dürftigkeitseinrede (§1990 BGB), Armenbegräbnis', 6, 10)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP06.1', 'Prüfung der Überschuldung', 'Aktiva-Passiva-Vergleich, drohende Überschuldung', 'analyze', 'analyze', 1, 'core'),
  (v_lf_id, 'NP06.2', 'Nachlassinsolvenzantrag (InsO § 317)', 'Pflicht des Nachlasspflegers, Verfahren, Wirkungen', 'apply', 'apply', 2, 'core'),
  (v_lf_id, 'NP06.3', 'Dürftigkeitseinrede (§ 1990 BGB)', 'Voraussetzungen, prozessuale Geltendmachung', 'apply', 'apply', 3, 'important'),
  (v_lf_id, 'NP06.4', 'Bestattung von Amts wegen / Armenbegräbnis', 'Sozialhilfeträger, Bestattungspflicht der Erben', 'understand', 'understand', 4, 'important'),
  (v_lf_id, 'NP06.5', 'Erschöpfungseinrede (§ 1991 BGB)', 'Abgrenzung zur Dürftigkeitseinrede', 'analyze', 'analyze', 5, 'supplementary');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP07', 'Unklare Vermögenslage und Gläubigeraufgebot',
          'Gläubigeraufgebot (BGB §§1970ff), Vergleichsangebote, Aufteilung unter Gläubigern', 7, 7)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP07.1', 'Gläubigeraufgebot (§§ 1970-1974 BGB)', 'Antrag, Wirkungen der Ausschließung', 'apply', 'apply', 1, 'important'),
  (v_lf_id, 'NP07.2', 'Vergleichsangebote an Gläubiger', 'Quotenangebot, Verhandlungstaktik', 'evaluate', 'evaluate', 2, 'supplementary'),
  (v_lf_id, 'NP07.3', 'Aufteilung des Nachlasses unter Gläubigern', 'Rangfolge, Quotenberechnung', 'analyze', 'analyze', 3, 'important'),
  (v_lf_id, 'NP07.4', 'Drei-Monats-Einrede (§ 2014 BGB)', 'Voraussetzungen, Wirkung, Fristberechnung', 'apply', 'apply', 4, 'core'),
  (v_lf_id, 'NP07.5', 'Inventarerrichtung als Schutzinstrument', 'Inventarpflicht, -frist, Folgen der Versäumung', 'apply', 'apply', 5, 'important');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP08', 'Nachlassgerichtliche Genehmigungen',
          'Genehmigungspflichtige Geschäfte; Praxis der Antragstellung', 8, 8)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP08.1', 'Genehmigungspflichtige Geschäfte (§§ 1821, 1822 BGB)', 'Grundstücksgeschäfte, Erbschaftsannahme, Kreditaufnahme', 'apply', 'apply', 1, 'core'),
  (v_lf_id, 'NP08.2', 'Genehmigungsantrag formulieren', 'Inhalt, Begründung, Unterlagen', 'create', 'create', 2, 'important'),
  (v_lf_id, 'NP08.3', 'Schwebende Unwirksamkeit', 'Rechtsfolgen fehlender Genehmigung', 'analyze', 'analyze', 3, 'important'),
  (v_lf_id, 'NP08.4', 'Genehmigungsfreie Geschäfte', 'Abgrenzung, Standardgeschäfte', 'understand', 'understand', 4, 'supplementary'),
  (v_lf_id, 'NP08.5', 'Eilfälle und Notgeschäftsführung', 'Unaufschiebbare Maßnahmen ohne Genehmigung', 'apply', 'apply', 5, 'supplementary');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP09', 'Haftung des Nachlasspflegers',
          'BGB §1833 i.V.m. §1915, Haftungsmaßstab, Berufshaftpflichtversicherung', 9, 6)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP09.1', 'Haftungsgrundlagen (§ 1833 BGB)', 'Sorgfaltsmaßstab, Vorsatz/Fahrlässigkeit', 'understand', 'understand', 1, 'important'),
  (v_lf_id, 'NP09.2', 'Typische Haftungsfälle', 'Verspätete Sicherung, fehlerhafte Verwaltung, Versäumung von Genehmigungen', 'analyze', 'analyze', 2, 'important'),
  (v_lf_id, 'NP09.3', 'Berufshaftpflichtversicherung', 'Pflicht (Berufsbetreuer-Analogie), Deckungssumme, Ausschlüsse', 'remember', 'remember', 3, 'supplementary'),
  (v_lf_id, 'NP09.4', 'Aufsicht durch das Nachlassgericht', 'Rechnungslegungspflichten, Anordnungsbefugnis', 'understand', 'understand', 4, 'supplementary'),
  (v_lf_id, 'NP09.5', 'Strafrechtliche Risiken', 'Untreue (§ 266 StGB), Unterschlagung', 'remember', 'remember', 5, 'supplementary');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP10', 'Vergütung des Nachlasspflegers',
          'VBVG, Stundensatzvergütung, Aufwendungsersatz, Festsetzungsverfahren', 10, 7)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP10.1', 'Vergütungsgrundlagen (§ 1915 i.V.m. VBVG)', 'Berufsmäßiger Nachlasspfleger, Stundensätze', 'apply', 'apply', 1, 'important'),
  (v_lf_id, 'NP10.2', 'Stundenaufzeichnung und Tätigkeitsnachweise', 'Anforderungen, EDV-Tools, Plausibilität', 'apply', 'apply', 2, 'core'),
  (v_lf_id, 'NP10.3', 'Antrag auf Vergütungsfestsetzung', 'Form, Frist, Anlagen', 'apply', 'apply', 3, 'important'),
  (v_lf_id, 'NP10.4', 'Aufwendungsersatz und Auslagen', 'Reisekosten, Porto, Sachverständige', 'apply', 'apply', 4, 'supplementary'),
  (v_lf_id, 'NP10.5', 'Vergütung bei mittellosem Nachlass', 'Staatskasse, Sonderregelungen', 'understand', 'understand', 5, 'supplementary');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP11', 'Beendigung der Pflegschaft und Übergabe',
          'Rechnungslegung, Schlussbericht, Übergabe an Erben oder Fiskus', 11, 7)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP11.1', 'Beendigungsgründe der Nachlasspflegschaft', 'Erbenermittlung erfolgreich, Insolvenzeröffnung, Aufhebung', 'understand', 'understand', 1, 'important'),
  (v_lf_id, 'NP11.2', 'Rechnungslegung (§ 1890 BGB)', 'Form, Inhalt, Belegpflicht', 'apply', 'apply', 2, 'core'),
  (v_lf_id, 'NP11.3', 'Schlussbericht', 'Aufbau, Pflichtinhalte, Adressaten', 'create', 'create', 3, 'important'),
  (v_lf_id, 'NP11.4', 'Übergabe an die Erben', 'Übergabeprotokoll, Quittung, Entlastung', 'apply', 'apply', 4, 'important'),
  (v_lf_id, 'NP11.5', 'Fiskuserbschaft (§ 1936 BGB)', 'Voraussetzungen, Verfahren der Übergabe', 'understand', 'understand', 5, 'supplementary');

  INSERT INTO learning_fields (id, curriculum_id, code, title, description, sort_order, weight_percent)
  VALUES (gen_random_uuid(), v_curr, 'NP12', 'Berufsethik und Praxisorganisation',
          'Datenschutz, Verschwiegenheit, Aktenführung, Falldokumentation, Selbstmanagement', 12, 5)
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, taxonomy_level, bloom_level, sort_order, exam_relevance_tier) VALUES
  (v_lf_id, 'NP12.1', 'Verschwiegenheitspflicht und Datenschutz', 'DSGVO, Auskunftsersuchen Dritter', 'apply', 'apply', 1, 'important'),
  (v_lf_id, 'NP12.2', 'Aktenführung und Aufbewahrungsfristen', 'Pflegschaftsakte, Belegarchiv, 30 Jahre', 'remember', 'remember', 2, 'important'),
  (v_lf_id, 'NP12.3', 'Umgang mit Angehörigen und Beteiligten', 'Kommunikation, Konfliktmanagement', 'apply', 'apply', 3, 'supplementary'),
  (v_lf_id, 'NP12.4', 'Fallzahlsteuerung und Selbstorganisation', 'Kapazitätsplanung, Fristenkontrolle', 'apply', 'apply', 4, 'supplementary'),
  (v_lf_id, 'NP12.5', 'Fortbildung und Berufsverbände', 'BAG Berufsbetreuer, Fachverband Erbrecht, Hoerner Bank Tagungen', 'remember', 'remember', 5, 'supplementary');

  INSERT INTO admin_actions (action, scope, payload)
  VALUES ('reseed_curriculum_nachlasspflegschaft_v1', 'curriculum',
          jsonb_build_object('curriculum_id', v_curr, 'package_id', v_pkg, 'lf_count', 12, 'comp_count', 60,
                             'sources', ARRAY['Weinsberger Forum 26 0137','BGB §§1960-1962, 1970-1974, 1990-1991, 2014','FamFG §§342-345','InsO §§315-317','VBVG','Siebert Nachlasspflegschaft Standardwerk']));
END $$;