
-- Cleanup
DELETE FROM lessons l USING modules m, courses co
WHERE l.module_id = m.id AND m.course_id = co.id
  AND co.curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9';

DELETE FROM handbook_sections hs USING handbook_chapters hc
WHERE hs.chapter_id = hc.id
  AND hc.curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9';

DELETE FROM handbook_chapters WHERE curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9';

DELETE FROM modules m USING courses co
WHERE m.course_id = co.id
  AND co.curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9';

DELETE FROM exam_blueprints WHERE curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9';

DELETE FROM competencies WHERE learning_field_id IN (
  SELECT id FROM learning_fields WHERE curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9'
);
DELETE FROM learning_fields WHERE curriculum_id = 'f464f6d2-5697-4f00-9a98-4610826688e9';

-- Reseed
DO $$
DECLARE
  curr_id uuid := 'f464f6d2-5697-4f00-9a98-4610826688e9';
  lf_id uuid;
BEGIN
  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf1','Rechtliche Grundlagen der Vormundschaft und Ergänzungspflegschaft',
    'Systematik der reformierten §§1773-1813 BGB, Abgrenzung Vormundschaft / Ergänzungspflegschaft / Pflegschaft / elterliche Sorge, Reform 2023.',1)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf1-k1','Reform des Vormundschafts- und Betreuungsrechts 2023','Ziele, Leitprinzipien (Subjektstellung des Mündels), zentrale Neuregelungen seit 01.01.2023.',1,'core','understand'),
    (lf_id,'lf1-k2','Voraussetzungen der Vormundschaft §§1773-1779 BGB','Ruhen / Entzug der elterlichen Sorge, Bestellungsverfahren, Auswahl, Eignung.',2,'core','apply'),
    (lf_id,'lf1-k3','Abgrenzung Ergänzungspflegschaft §§1809-1813 BGB','Teilbereichszuständigkeit, typische Wirkungskreise, Verhältnis zur sorgeberechtigten Person.',3,'core','analyze'),
    (lf_id,'lf1-k4','Vormundschaftsformen','Einzel-, Mit-, Vereins-, Amts- und Berufsvormundschaft, Vor- und Nachteile.',4,'core','understand'),
    (lf_id,'lf1-k5','Rolle und Berufsbild Berufsvormund:in','Selbständigkeit, Fallzahlhöchstgrenzen, BVEB-Standards, Berufsethik.',5,'core','understand');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf2','Persönliche Pflichten und Beziehungsgestaltung zum Mündel',
    'Persönlicher Kontakt §1790 BGB, Beteiligung des Mündels, Bindungs- und Beziehungsarbeit.',2)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf2-k1','Persönlicher Kontakt §1790 BGB','Mindestens monatlicher Besuch, Gestaltung in der Lebenswelt des Kindes.',1,'core','apply'),
    (lf_id,'lf2-k2','Beteiligungsrechte §1788 BGB','Information, Anhörung, Berücksichtigung des Willens nach Alter und Reife.',2,'core','apply'),
    (lf_id,'lf2-k3','Bindungs- und Beziehungstheorie','Bowlby/Ainsworth, sichere Bindung, Beziehungsabbrüche, Trauma-sensitive Haltung.',3,'core','understand'),
    (lf_id,'lf2-k4','Kommunikation mit Kindern und Jugendlichen','Altersgerechte Sprache, partizipative Methoden, Gesprächsführung.',4,'core','apply'),
    (lf_id,'lf2-k5','Loyalitätskonflikte','Mündel zwischen Herkunftsfamilie, Pflegefamilie, Heim und Vormund.',5,'core','analyze');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf3','Personensorge: Aufenthalt, Pflege, Erziehung, Gesundheit',
    'Aufenthaltsbestimmung, Pflege, Erziehung, Gesundheitssorge, religiöse Erziehung.',3)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf3-k1','Aufenthaltsbestimmung','Pflegestelle / Heim / Verwandte / Inobhutnahme §42 SGB VIII.',1,'core','apply'),
    (lf_id,'lf3-k2','Gesundheitssorge und Einwilligung','Heilbehandlung, Impfungen, Aufklärung, §1631e BGB.',2,'core','apply'),
    (lf_id,'lf3-k3','Schule und Bildung','Schulwahl, Förderbedarf, sonderpädagogische Hilfen, Inklusion.',3,'core','apply'),
    (lf_id,'lf3-k4','Religiöse Erziehung','§1801 BGB i.V.m. RelKErzG, Wille des Mündels, Konfession.',4,'core','understand'),
    (lf_id,'lf3-k5','Gewaltfreie Erziehung','§1631 Abs.2 BGB, Grenzen körperlicher Maßnahmen.',5,'core','understand');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf4','Vermögenssorge und mündelsichere Anlage',
    'Mündelvermögen, Genehmigungspflichten, Rechnungslegung.',4)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf4-k1','Vermögensverzeichnis §1802 BGB','Erstellung, Abgabe, Aktualisierung.',1,'core','apply'),
    (lf_id,'lf4-k2','Mündelsichere Anlage §§1841-1847 BGB','Sperrvermerk, Anlagearten, Genehmigungen.',2,'core','apply'),
    (lf_id,'lf4-k3','Genehmigungspflichten §§1848-1854 BGB','Grundstücke, Verfügungen, Schenkungen, Erbschaften.',3,'core','apply'),
    (lf_id,'lf4-k4','Rechnungslegung §1862 BGB','Jährliche Rechnung, Schlussrechnung, Belege.',4,'core','apply'),
    (lf_id,'lf4-k5','Unterhalt und Sozialleistungen','Unterhaltsansprüche, Kindergeld, Halbwaisenrente, BAföG.',5,'core','apply');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf5','Gesetzliche Vertretung und Rechtsgeschäfte',
    'Vertretungsmacht, Insichgeschäfte, Anhörung, Genehmigungen.',5)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf5-k1','Umfang der Vertretungsmacht','Personensorge + Vermögenssorge, Insichgeschäfte §1824 BGB.',1,'core','apply'),
    (lf_id,'lf5-k2','Familiengerichtliche Genehmigungen','Katalog §§1850-1854 BGB, Verfahren.',2,'core','apply'),
    (lf_id,'lf5-k3','Beschränkt Geschäftsfähige §§106-113 BGB','Taschengeld, Arbeit, selbständiger Erwerb.',3,'core','apply'),
    (lf_id,'lf5-k4','Ausweisangelegenheiten','Pass, Personalausweis, Aufenthaltstitel.',4,'core','apply'),
    (lf_id,'lf5-k5','Verträge im Mündelinteresse','Miete, Handy, Versicherungen.',5,'core','apply');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf6','Aufsicht des Familiengerichts und Berichtswesen',
    'Familiengericht, Jahresbericht §1863 BGB, Verfahren.',6)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf6-k1','Aufsicht §1802 BGB','Prüfungs-/Eingriffsrechte, Auskunftspflichten.',1,'core','understand'),
    (lf_id,'lf6-k2','Jahresbericht §1863 BGB','Pflichtinhalte, Form, Frist.',2,'core','apply'),
    (lf_id,'lf6-k3','FamFG-Verfahren','Anhörung, Beschluss, Beschwerde §58 FamFG.',3,'core','apply'),
    (lf_id,'lf6-k4','Beendigung der Vormundschaft §§1882-1888 BGB','Volljährigkeit, Wiederherstellung Sorge, Tod, Entlassung.',4,'core','understand'),
    (lf_id,'lf6-k5','Haftung des Vormunds §1826 BGB','Sorgfaltspflicht, Schadensersatz, Haftpflichtversicherung.',5,'core','analyze');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf7','Kinderschutz und Kindeswohlgefährdung',
    '§8a SGB VIII, §1666 BGB, Schutzkonzepte, Inobhutnahme.',7)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf7-k1','Kindeswohlgefährdung §1666 BGB','Tatbestand, gerichtliche Maßnahmen, Verhältnismäßigkeit.',1,'core','analyze'),
    (lf_id,'lf7-k2','Schutzauftrag §8a SGB VIII','Risikoeinschätzung, insoweit erfahrene Fachkraft.',2,'core','apply'),
    (lf_id,'lf7-k3','Inobhutnahme §42 SGB VIII','Voraussetzungen, Verfahren, Beteiligung.',3,'core','apply'),
    (lf_id,'lf7-k4','Misshandlungs- und Vernachlässigungsformen','Erkennen körperlich, emotional, sexuell.',4,'core','analyze'),
    (lf_id,'lf7-k5','Gefährdungsdiagnostik','Strukturierte Verfahren (Stuttgarter Kinderschutzbogen).',5,'core','apply');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf8','SGB VIII – Hilfen zur Erziehung und Hilfeplanung',
    'Anspruch, Hilfeplan §36 SGB VIII, Pflegekinderhilfe, Heim.',8)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf8-k1','Hilfen zur Erziehung §§27-35 SGB VIII','Spektrum SPFH bis ISE, Mitwirkung.',1,'core','apply'),
    (lf_id,'lf8-k2','Hilfeplan §36 SGB VIII','Hilfeplangespräch, Beteiligung, §5 Wunsch- und Wahlrecht.',2,'core','apply'),
    (lf_id,'lf8-k3','Pflegekinderhilfe §§33,37 SGB VIII','Vollzeit-, Bereitschafts-, Verwandtenpflege.',3,'core','apply'),
    (lf_id,'lf8-k4','Heimerziehung §34 SGB VIII','Stationäre Hilfen, betreutes Wohnen, Verselbständigung.',4,'core','apply'),
    (lf_id,'lf8-k5','Eingliederungshilfe §35a SGB VIII / SGB IX','Seelische Behinderung, Teilhabeleistungen.',5,'core','apply');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf9','Vormundschaft für unbegleitete minderjährige Geflüchtete',
    'AsylG, AufenthG, Clearing, Altersfeststellung.',9)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf9-k1','Verteilungsverfahren §§42a-f SGB VIII','Vorläufige Inobhutnahme, bundesweite Verteilung.',1,'core','apply'),
    (lf_id,'lf9-k2','Altersfeststellung §42f SGB VIII','Inaugenscheinnahme, ärztliche Untersuchung, Rechtsschutz.',2,'core','apply'),
    (lf_id,'lf9-k3','Asylverfahren und subsidiärer Schutz','Antrag, BAMF-Anhörung, Familienzusammenführung.',3,'core','apply'),
    (lf_id,'lf9-k4','Aufenthaltstitel und Duldung','§§25,25a,25b AufenthG, §60c Ausbildungsduldung.',4,'core','apply'),
    (lf_id,'lf9-k5','Trauma-sensible Begleitung','PTBS, Resilienz, Kultur- und Religionssensibilität.',5,'core','understand');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf10','Zusammenarbeit mit Herkunftsfamilie, Pflegefamilie und Einrichtungen',
    'Umgang, Elternarbeit, Kooperation Pflegestellen/Heimen.',10)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf10-k1','Umgangsrecht §1684 BGB','Umgangsregelung, begleiteter Umgang, Ausschluss.',1,'core','apply'),
    (lf_id,'lf10-k2','Elternarbeit trotz Sorgerechtsentzug','Beteiligung, Information.',2,'core','apply'),
    (lf_id,'lf10-k3','Kooperation mit Pflegefamilien','Verbleibensanordnung §1632 BGB, Rollenklarheit.',3,'core','apply'),
    (lf_id,'lf10-k4','Zusammenarbeit Heim und ASD','Schnittstellen, Hilfeplanung, Konflikte.',4,'core','apply'),
    (lf_id,'lf10-k5','Familienrekonstruktion und Rückführung','Voraussetzungen Rückkehroption, Perspektivklärung.',5,'core','analyze');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf11','UN-Kinderrechtskonvention und Partizipation',
    'UN-KRK, Beteiligung, Beschwerdesysteme, Ombudsstellen.',11)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf11-k1','Vier Grundprinzipien UN-KRK','Diskriminierungsverbot, Kindeswohl, Leben/Entwicklung, Beteiligung Art.12.',1,'core','understand'),
    (lf_id,'lf11-k2','Beschwerdesysteme/Ombudsstellen','§9a SGB VIII, BNO, externe Stellen.',2,'core','apply'),
    (lf_id,'lf11-k3','Beteiligung in Einrichtungen','Heimrat, §45 SGB VIII Betriebserlaubnis.',3,'core','apply'),
    (lf_id,'lf11-k4','Recht auf Bildung und Identität','Art.28-30 UN-KRK.',4,'core','understand'),
    (lf_id,'lf11-k5','Inklusive Vormundschaft','Behinderung, Diversität, Intersektionalität.',5,'core','understand');

  INSERT INTO learning_fields (curriculum_id, code, title, description, sort_order)
  VALUES (curr_id,'lf12','Berufsethik, Selbstorganisation, Vergütung und Aktenführung',
    'BVEB-Standards, VBVG, Akten, Datenschutz, Supervision.',12)
  RETURNING id INTO lf_id;
  INSERT INTO competencies (learning_field_id, code, title, description, sort_order, exam_relevance_tier, taxonomy_level) VALUES
    (lf_id,'lf12-k1','BVEB-Standards und Berufsethik','Qualität, Fallzahlen, Verschwiegenheit, Allparteilichkeit.',1,'core','understand'),
    (lf_id,'lf12-k2','Vergütung VBVG / JVEG','Stundensätze, Pauschalen, Reisekosten.',2,'core','apply'),
    (lf_id,'lf12-k3','Aktenführung und Dokumentation','Struktur, Aufbewahrung, digitale Akte.',3,'core','apply'),
    (lf_id,'lf12-k4','Datenschutz DSGVO/§35 SGB I','Sozialdatenschutz, Schweigepflicht §203 StGB.',4,'core','apply'),
    (lf_id,'lf12-k5','Selbstfürsorge und Supervision','Sekundärtraumatisierung, kollegiale Beratung, Burnout-Prävention.',5,'core','understand');
END $$;

INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'reseed_curriculum_berufsvormund_v1','curriculum',
  jsonb_build_object(
    'curriculum_id','f464f6d2-5697-4f00-9a98-4610826688e9',
    'package_id','55036b44-7427-438f-81f2-3707c804d41f',
    'learning_fields',12,'competencies',60,
    'sources',ARRAY['BVEB-Standards','Bundesforum Vormundschaft','BGB §§1773-1813 (Reform 2023)','SGB VIII','UN-KRK','Weinsberger Forum'],
    'reform_basis','Vormundschafts- und Betreuungsrechtsreform 01.01.2023'
  ),
  ARRAY['f464f6d2-5697-4f00-9a98-4610826688e9']::text[]
);
