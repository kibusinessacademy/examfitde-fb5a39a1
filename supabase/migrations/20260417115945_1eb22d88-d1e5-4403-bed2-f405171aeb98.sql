
-- ════════════════════════════════════════════════════════════════════
-- PILOT 2: Reseed Curriculum Testamentsvollstrecker (BGB §§2197-2228)
-- Curriculum-ID: 8acb4179-6d80-434a-9071-71fdce216792
-- Quelle: AGT-Standard + BGB-Erbrecht + Praxiswissen Testamentsvollstreckung
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_curr UUID := '8acb4179-6d80-434a-9071-71fdce216792';
  v_lf_id UUID;
BEGIN
  -- ── Phase 1: FK-Cleanup (Lessons → Modules → LF/Competencies) ──
  DELETE FROM lessons WHERE module_id IN (
    SELECT m.id FROM modules m
    JOIN learning_fields lf ON lf.id = m.learning_field_id
    WHERE lf.curriculum_id = v_curr
  );
  DELETE FROM handbook_sections WHERE chapter_id IN (
    SELECT hc.id FROM handbook_chapters hc WHERE hc.curriculum_id = v_curr
  );
  DELETE FROM modules WHERE learning_field_id IN (
    SELECT id FROM learning_fields WHERE curriculum_id = v_curr
  );
  DELETE FROM competencies WHERE learning_field_id IN (
    SELECT id FROM learning_fields WHERE curriculum_id = v_curr
  );
  DELETE FROM learning_fields WHERE curriculum_id = v_curr;

  -- ── Phase 2: 12 LFs + ~60 Kompetenzen einfügen ──

  -- LF 1: Rechtliche Grundlagen Erbrecht
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf1', 'Rechtliche Grundlagen des Erbrechts (BGB §§1922-2063)', 10, 1, 'foundation', 'Teil 1')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf1-k1', 'Erbfolge nach Gesetz (BGB §§1924-1936): Ordnungen, Erbteile, Repräsentation', 1),
    (v_lf_id, 'tv-lf1-k2', 'Gewillkürte Erbfolge: Testament, Erbvertrag, Pflichtteil (§§2303 ff.)', 2),
    (v_lf_id, 'tv-lf1-k3', 'Erbschaftsannahme/-ausschlagung (§§1942-1957) und Haftung des Erben', 3),
    (v_lf_id, 'tv-lf1-k4', 'Erbengemeinschaft: Verwaltung, Auseinandersetzung (§§2032-2057a)', 4),
    (v_lf_id, 'tv-lf1-k5', 'Vermächtnis, Auflage, Ersatz- und Nacherbschaft (§§2100 ff., 2147 ff.)', 5);

  -- LF 2: Rechtsstellung des Testamentsvollstreckers
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf2', 'Rechtsstellung & Arten der Testamentsvollstreckung (BGB §§2197-2228)', 10, 2, 'foundation', 'Teil 1')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf2-k1', 'Ernennung & Annahme des Amtes (§§2197-2202), Ausschlagung', 1),
    (v_lf_id, 'tv-lf2-k2', 'Arten: Abwicklungs-, Verwaltungs-, Dauer-, Nachlassvollstreckung (§§2209, 2210)', 2),
    (v_lf_id, 'tv-lf2-k3', 'Mehrheit von Testamentsvollstreckern (§§2224-2226), Mit-/Gesamtvollstreckung', 3),
    (v_lf_id, 'tv-lf2-k4', 'Beendigung des Amtes: Erledigung, Kündigung, Entlassung (§§2225-2227)', 4),
    (v_lf_id, 'tv-lf2-k5', 'Testamentsvollstreckerzeugnis (§§2368): Antrag, Wirkung, Kraftloserklärung', 5);

  -- LF 3: Aufgaben & Pflichten der Abwicklungsvollstreckung
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf3', 'Aufgaben & Pflichten der Abwicklungsvollstreckung', 10, 3, 'application', 'Teil 1')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf3-k1', 'Nachlassinbesitznahme & -sicherung (§§2205, 2215)', 1),
    (v_lf_id, 'tv-lf3-k2', 'Nachlassverzeichnis erstellen (§§2215): Form, Inhalt, Bewertung', 2),
    (v_lf_id, 'tv-lf3-k3', 'Erfüllung von Vermächtnissen, Auflagen, Pflichtteilen (§§2203, 2213)', 3),
    (v_lf_id, 'tv-lf3-k4', 'Auseinandersetzung der Erbengemeinschaft (§§2204): Plan, Vollzug', 4),
    (v_lf_id, 'tv-lf3-k5', 'Rechenschafts- und Auskunftspflicht (§§2218, 666)', 5);

  -- LF 4: Verwaltungs- & Dauervollstreckung
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf4', 'Verwaltungs- und Dauertestamentsvollstreckung (§§2209, 2210)', 9, 4, 'application', 'Teil 1')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf4-k1', 'Anordnung der Dauervollstreckung: 30-Jahres-Grenze (§2210), Ausnahmen', 1),
    (v_lf_id, 'tv-lf4-k2', 'Verwaltungshandlungen: ordnungsgemäße Verwaltung, Anlagepflichten', 2),
    (v_lf_id, 'tv-lf4-k3', 'Verfügungsbeschränkungen des Erben (§§2211-2214)', 3),
    (v_lf_id, 'tv-lf4-k4', 'Behindertentestament & Bedürftigentestament: Sittenwidrigkeit, Sozialhilferegress', 4),
    (v_lf_id, 'tv-lf4-k5', 'Unternehmens-Testamentsvollstreckung: Handelsrechtliche Besonderheiten', 5);

  -- LF 5: Nachlassbewertung & Vermögensverwaltung
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf5', 'Nachlassbewertung & Vermögensverwaltung', 8, 5, 'application', 'Teil 1')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf5-k1', 'Bewertung von Immobilien (Sachwert, Ertragswert, Vergleichswert)', 1),
    (v_lf_id, 'tv-lf5-k2', 'Bewertung von Unternehmensanteilen, GmbH/KG, Wertpapierdepots', 2),
    (v_lf_id, 'tv-lf5-k3', 'Verkehrswert vs. Steuerwert (BewG): Abweichungen erkennen', 3),
    (v_lf_id, 'tv-lf5-k4', 'Mündelsichere Anlage (§§1806-1811 i.V.m. §2216): Pflichten, Haftung', 4),
    (v_lf_id, 'tv-lf5-k5', 'Liquidität sichern: Konten, Mietverwaltung, laufende Verbindlichkeiten', 5);

  -- LF 6: Erbschaftsteuer
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf6', 'Erbschaftsteuerrecht (ErbStG) & Steuererklärungspflichten', 9, 6, 'application', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf6-k1', 'Steuerklassen, Freibeträge, Steuersätze (§§15, 16, 19 ErbStG)', 1),
    (v_lf_id, 'tv-lf6-k2', 'Steuererklärungspflicht des TV (§31 ErbStG): Fristen, Form', 2),
    (v_lf_id, 'tv-lf6-k3', 'Bewertung Betriebsvermögen (§§13a, 13b ErbStG): Verschonungsabschlag', 3),
    (v_lf_id, 'tv-lf6-k4', 'Anzeigepflichten (§30 ErbStG), Berichtigungspflichten (§153 AO)', 4),
    (v_lf_id, 'tv-lf6-k5', 'Stundung & Aussetzung der Vollziehung, Steueroptimierung', 5);

  -- LF 7: Pflichtteilsrecht
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf7', 'Pflichtteilsrecht & Pflichtteilsergänzung (§§2303-2338)', 8, 7, 'application', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf7-k1', 'Pflichtteilsberechtigte & -höhe (§§2303, 2305): Berechnungsbeispiele', 1),
    (v_lf_id, 'tv-lf7-k2', 'Pflichtteilsergänzung bei Schenkungen (§§2325-2329): Abschmelzung 10%', 2),
    (v_lf_id, 'tv-lf7-k3', 'Auskunfts- und Wertermittlungsanspruch (§2314)', 3),
    (v_lf_id, 'tv-lf7-k4', 'Pflichtteilsentziehung & -verzicht (§§2333, 2346)', 4),
    (v_lf_id, 'tv-lf7-k5', 'Stundung des Pflichtteils (§2331a) & Verjährung', 5);

  -- LF 8: Haftung des Testamentsvollstreckers
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf8', 'Haftung & Pflichtverletzungen des Testamentsvollstreckers (§2219)', 8, 8, 'mastery', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf8-k1', 'Haftungsmaßstab (§2219 i.V.m. §276): Vorsatz, Fahrlässigkeit', 1),
    (v_lf_id, 'tv-lf8-k2', 'Typische Haftungsfälle: verspätete Steuererklärung, Fehlanlage, Pflichtteilsfehler', 2),
    (v_lf_id, 'tv-lf8-k3', 'Vermögensschadenshaftpflicht-Versicherung: Deckung, Höhe, Pflicht', 3),
    (v_lf_id, 'tv-lf8-k4', 'Entlassungsverfahren (§2227): Antrag, gerichtliche Prüfung', 4),
    (v_lf_id, 'tv-lf8-k5', 'Strafrechtliche Risiken: Untreue (§266 StGB), Steuerhinterziehung (§370 AO)', 5);

  -- LF 9: Vergütung
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf9', 'Vergütung des Testamentsvollstreckers (§2221)', 7, 9, 'application', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf9-k1', 'Angemessene Vergütung (§2221): Rechtsprechungsgrundsätze', 1),
    (v_lf_id, 'tv-lf9-k2', 'Neue Rheinische Tabelle: Grundvergütung & Zuschläge', 2),
    (v_lf_id, 'tv-lf9-k3', 'Empfehlungen DNotV / Eckhoff-Tabelle: Anwendung in der Praxis', 3),
    (v_lf_id, 'tv-lf9-k4', 'Vergütungsbestimmung durch Erblasser & gerichtliche Festsetzung', 4),
    (v_lf_id, 'tv-lf9-k5', 'Umsatzsteuer auf TV-Vergütung, Auslagenersatz', 5);

  -- LF 10: Internationales Erbrecht
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf10', 'Internationales Erbrecht & EU-ErbVO (Verordnung 650/2012)', 7, 10, 'application', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf10-k1', 'EU-Erbrechtsverordnung: Anknüpfung gewöhnlicher Aufenthalt (Art. 21)', 1),
    (v_lf_id, 'tv-lf10-k2', 'Rechtswahl (Art. 22 EU-ErbVO): Form, Reichweite, Grenzen', 2),
    (v_lf_id, 'tv-lf10-k3', 'Europäisches Nachlasszeugnis (Art. 62 ff.): Beantragung, Wirkung', 3),
    (v_lf_id, 'tv-lf10-k4', 'Auslandsvermögen: Bewertung, Steuerpflicht, DBA-Erbschaftsteuer', 4),
    (v_lf_id, 'tv-lf10-k5', 'Common-Law-Systeme (UK/USA): Probate, Executor — Abgrenzung TV', 5);

  -- LF 11: Streitvermeidung & Mediation
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf11', 'Konfliktmanagement, Streitvermeidung & Erbenkommunikation', 6, 11, 'mastery', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf11-k1', 'Strukturierte Erbenkommunikation: Erstgespräch, Statusberichte', 1),
    (v_lf_id, 'tv-lf11-k2', 'Mediation in der Erbengemeinschaft: Methoden, Grenzen, Honorierung', 2),
    (v_lf_id, 'tv-lf11-k3', 'Umgang mit Pflichtteilsstreitigkeiten: Verhandlungsstrategien', 3),
    (v_lf_id, 'tv-lf11-k4', 'Dokumentation & Beweissicherung: Protokolle, Schriftverkehr', 4),
    (v_lf_id, 'tv-lf11-k5', 'Eskalationsmanagement: Wann Anwalt/Gericht einschalten?', 5);

  -- LF 12: Praxis & Berufsethik
  INSERT INTO learning_fields (curriculum_id, code, title, weight_percent, sort_order, difficulty_tier, exam_part)
  VALUES (v_curr, 'tv-lf12', 'Berufspraxis, Ethik & Qualitätsstandards (AGT-Berufsordnung)', 8, 12, 'mastery', 'Teil 2')
  RETURNING id INTO v_lf_id;
  INSERT INTO competencies (learning_field_id, code, title, sort_order) VALUES
    (v_lf_id, 'tv-lf12-k1', 'AGT-Berufsordnung: Grundsätze, Unabhängigkeit, Verschwiegenheit', 1),
    (v_lf_id, 'tv-lf12-k2', 'Interessenkonflikte erkennen & vermeiden (Doppelmandate)', 2),
    (v_lf_id, 'tv-lf12-k3', 'Geldwäscheprävention (GwG): Identifizierung, Meldepflichten', 3),
    (v_lf_id, 'tv-lf12-k4', 'Datenschutz (DSGVO) im TV-Mandat: Erbendaten, Bankenanfragen', 4),
    (v_lf_id, 'tv-lf12-k5', 'Qualitätsmanagement: Aktenführung, Fristenkontrolle, Fortbildung', 5);

  -- ── Phase 3: Audit ──
  INSERT INTO admin_actions (action, scope, payload)
  VALUES (
    'reseed_curriculum_testamentsvollstrecker_v1',
    'curriculum:8acb4179-6d80-434a-9071-71fdce216792',
    jsonb_build_object(
      'old_lfs', 4, 'new_lfs', 12,
      'old_competencies', 12, 'new_competencies', 60,
      'standard', 'AGT + BGB-Erbrecht + ErbStG',
      'pilot', 'pilot_2_testamentsvollstrecker'
    )
  );
END $$;
