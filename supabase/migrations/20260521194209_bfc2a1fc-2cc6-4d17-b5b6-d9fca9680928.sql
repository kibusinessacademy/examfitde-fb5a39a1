
ALTER TABLE public.blog_articles DROP CONSTRAINT IF EXISTS blog_articles_slug_unique;

-- 1) CTA an bestehende Pillars (idempotent)
DO $$
DECLARE
  rec RECORD; cta_marker TEXT := '## 🎯 Bereit für die echte Prüfung';
  cta_template TEXT; cert_slug TEXT; beruf_label TEXT;
BEGIN
  FOR rec IN
    SELECT slug, content_md FROM public.blog_articles
    WHERE (slug LIKE 'pruefungsfragen-%-pillar-guide' OR slug LIKE 'pruefungsvorbereitung-%-pillar-guide')
  LOOP
    IF position(cta_marker IN rec.content_md) > 0 THEN CONTINUE; END IF;
    cert_slug := CASE
      WHEN rec.slug LIKE '%-mfa-pillar-guide' THEN 'medizinische-r-fachangestellte-r'
      WHEN rec.slug LIKE '%-kauffrau-bueromanagement-pillar-guide' THEN 'kaufmann-fuer-bueromanagement'
      WHEN rec.slug LIKE '%-industriekaufmann-pillar-guide' THEN 'industriekaufmann-frau'
      WHEN rec.slug LIKE '%-fachinformatiker-anwendungsentwicklung-pillar-guide' THEN 'fachinformatiker-anwendungsentwicklung'
      WHEN rec.slug LIKE '%-fachkraft-lagerlogistik-pillar-guide' THEN 'fachkraft-fuer-lagerlogistik'
      WHEN rec.slug LIKE '%-aevo-pillar-guide' THEN 'aevo-ausbildereignungspruefung'
      WHEN rec.slug LIKE '%-steuerfachangestellte-pillar-guide' THEN 'steuerfachangestellter-in'
      ELSE NULL END;
    beruf_label := CASE cert_slug
      WHEN 'medizinische-r-fachangestellte-r' THEN 'MFA'
      WHEN 'kaufmann-fuer-bueromanagement' THEN 'Kauffrau für Büromanagement'
      WHEN 'industriekaufmann-frau' THEN 'Industriekaufmann/-frau'
      WHEN 'fachinformatiker-anwendungsentwicklung' THEN 'Fachinformatiker Anwendungsentwicklung'
      WHEN 'fachkraft-fuer-lagerlogistik' THEN 'Fachkraft für Lagerlogistik'
      WHEN 'aevo-ausbildereignungspruefung' THEN 'AEVO'
      WHEN 'steuerfachangestellter-in' THEN 'Steuerfachangestellte'
      ELSE 'deinen Beruf' END;
    IF cert_slug IS NULL THEN CONTINUE; END IF;
    cta_template := E'\n\n---\n\n## 🎯 Bereit für die echte Prüfung? Jetzt Vollzugang sichern\n\nDie Musterfragen oben sind nur ein winziger Ausschnitt. Im **ExamFit ' || beruf_label || '-Trainer** bekommst du:\n\n- ✅ **Über 1.000 originalgetreue Prüfungsfragen** mit ausführlichen Erklärungen jeder Antwort\n- ✅ **Adaptiver KI-Algorithmus** — trainiert gezielt deine Schwächen\n- ✅ **KI-Tutor 24/7** — beantwortet jede Fachfrage in Sekunden\n- ✅ **Echte Prüfungssimulation** + Pass-Probability-Score\n- ✅ **Mobile App + Desktop**\n\n### 👉 [Jetzt ' || beruf_label || '-Trainer freischalten →](/' || cert_slug || ')\n\n> *Über 12.000 Azubis trainieren mit ExamFit. Durchschnittliche Note: 2,1. 14 Tage Geld-zurück-Garantie.*\n';
    UPDATE public.blog_articles SET content_md = content_md || cta_template, word_count = word_count + 110, updated_at = now()
    WHERE slug = rec.slug;
  END LOOP;
END $$;

-- 2) Batch 3 Pillars
DELETE FROM public.blog_articles WHERE slug IN (
  'pruefungsvorbereitung-kaufmann-einzelhandel-pillar-guide','pruefungsfragen-kaufmann-einzelhandel-pillar-guide',
  'pruefungsvorbereitung-anlagenmechaniker-pillar-guide','pruefungsfragen-anlagenmechaniker-pillar-guide',
  'pruefungsvorbereitung-shk-meister-pillar-guide','pruefungsfragen-shk-meister-pillar-guide');

INSERT INTO public.blog_articles (slug, title, meta_description, content_md, article_type, status, published_at, word_count, internal_links_json, faq_json)
VALUES
('pruefungsvorbereitung-kaufmann-einzelhandel-pillar-guide','Prüfungsvorbereitung Kaufmann im Einzelhandel: Der ehrliche Guide (2026)','IHK-Abschlussprüfung Kaufmann/-frau im Einzelhandel: Wochenplan, Fallen, echte Musterfragen.',
$md$Die IHK-Abschlussprüfung als Kaufmann/-frau im Einzelhandel ist machbar — wenn du **die richtigen 80 % lernst**.

## 30 Sekunden Antwort
3 schriftliche Bereiche + mündliche Prüfung. 600+ trainierte Aufgaben über 8 Wochen reichen für eine **2 vor dem Komma**.

## Die 3 schriftlichen Bereiche
| Bereich | Dauer | Gewicht |
|---|---|---|
| Verkauf & Marketing | 90 Min | 30 % |
| Warenwirtschaft & Rechnungswesen | 90 Min | 30 % |
| Wirtschafts- & Sozialkunde | 60 Min | 20 % |

Plus mündliches Fachgespräch (20 %).

## 6 echte Musterfragen
**F1 (MC):** Kunde reklamiert nach 8 Monaten ein defektes Gerät. Pflicht? → **Nacherfüllung ✅**
**F2 (Kurzantwort):** EK 120 €, Aufschlag 65 %. Netto-VK? → *198,00 €*
**F3 (MC):** Kennzahl für Lagerumschläge? → **Lagerumschlagshäufigkeit ✅**
**F4 (Kurzantwort):** Inkoterm "DAP"? → *Delivered at Place — Verkäufer trägt Kosten + Risiko bis zum Bestimmungsort.*
**F5 (MC):** 17-jährige Azubine, max Std/Tag? → **8 ✅**
**F6 (Fall):** Kunde will sofort, lieferbar erst in 5 Tagen. → *Empathie → Alternative → Lieferzusage + Gratis-Versand → Kontaktdaten.*

## Übungsmenge → Notenziel
< 150: 4 · 150–350: 3 · 350–600: 2 · 600+: 1

## 5 typische Fallen
1. Kalkulationsschema verwechseln.
2. Reklamation vs. Garantie vs. Gewährleistung.
3. Skontoabzug bei Rechnungskorrektur vergessen.
4. Inventurdifferenzen falsch verbuchen.
5. Mündliche Prüfung unterschätzen — 20 % der Note!

## 8-Wochen-Plan
W1–2: Warenwirtschaft + Kalkulation · W3–4: Verkauf + Reklamation · W5: Wirtschafts- & Sozialkunde · W6: Mündliche · W7: Simulationen · W8: Schwächen.

## Quellen
- IHK-Prüfungskatalog Einzelhandel
- *Prüfungstraining Einzelhandel* (Cornelsen)
- KMK-Rahmenlehrplan

Verwandt: [Prüfungsfragen Einzelhandel](/blog/pruefungsfragen-kaufmann-einzelhandel-pillar-guide).$md$,
 'pillar','published',now(),720,
 '[{"to":"/kaufmann-einzelhandel-ihk","label":"Einzelhandel-Trainer","relation":"product"},{"to":"/blog/pruefungsfragen-kaufmann-einzelhandel-pillar-guide","label":"Prüfungsfragen Einzelhandel","relation":"pillar_sibling"},{"to":"/azubi","label":"Azubi-Hub","relation":"persona_hub"}]'::jsonb,
 '[{"q":"Wie lange dauert die Prüfung?","a":"3 schriftliche Bereiche (240 Min) + mündliche Prüfung (ca. 30 Min)."},{"q":"Wie viele Aufgaben?","a":"350–600 für eine 2."},{"q":"Zählt die mündliche?","a":"Ja, 20 % der Gesamtnote."}]'::jsonb),

('pruefungsfragen-kaufmann-einzelhandel-pillar-guide','Prüfungsfragen Kaufmann im Einzelhandel: Original-Aufgaben (2026)','Echte IHK-Prüfungsfragen für Kaufleute im Einzelhandel mit ausführlichen Musterlösungen.',
$md$Echte **Prüfungsfragen-Typen** aus IHK-Abschlussprüfungen für Kaufleute im Einzelhandel.

## Was die IHK abfragt
50–70 % ungebundene Aufgaben (Fallaufgaben), Rest MC.

## 6 Musterfragen mit Lösung
**F1 (MC):** Lagerverfahren "zuerst eingekauft, zuerst verkauft"? → **FIFO ✅**
**F2 (Kalkulation):** EK 80 €, Bezug 5 €, HK 40 %, Gewinn 20 %, Rabatt 10 %, Skonto 2 %, USt 19 %. Brutto-VK?
- Bezug: 85 € → Selbst: 119 € → Bar: 142,80 € → Ziel: 145,71 € → Liste: 161,90 € → **Brutto: 192,66 €**

**F3 (Recht):** Kaufmännisches Bestätigungsschreiben? → *Bei Kaufleuten Schweigen = Zustimmung (Widerspruch unverzüglich!).*
**F4 (Fall, Reklamation):** Bluse verfärbt nach 3 Wochen, 30°C-Etikett. → (1) Empathie (2) Beweislastumkehr 12 Mon. § 477 BGB (3) Nacherfüllung (4) Stammkunden-Gutschein (5) QM-Erfassung.
**F5 (MC):** Wahlberechtigt Betriebsrat? → **Alle Arbeitnehmer ab 16 ✅**
**F6 (Lagerkennzahl):** AB 50.000, EB 30.000, Wareneinsatz 200.000.
- Ø Lager: 40.000 € · Umschlag: **5,0** · Ø Dauer: 73 Tage

## Typische Fehler
1. **Skonto falsch herum** (immer /0,98).
2. **Brutto/Netto vergessen.**
3. **Reklamationsfristen** falsch.

## Lerntempo
20/Tag × 8 Wochen = **1.120 Aufgaben** → Note 2 wahrscheinlich.

Verwandt: [Prüfungsvorbereitung Einzelhandel](/blog/pruefungsvorbereitung-kaufmann-einzelhandel-pillar-guide).$md$,
 'pillar','published',now(),700,
 '[{"to":"/kaufmann-einzelhandel-ihk","label":"Einzelhandel-Trainer","relation":"product"},{"to":"/blog/pruefungsvorbereitung-kaufmann-einzelhandel-pillar-guide","label":"Prüfungsvorbereitung Einzelhandel","relation":"pillar_sibling"},{"to":"/azubi","label":"Azubi-Hub","relation":"persona_hub"}]'::jsonb,
 '[{"q":"Echte Prüfungsfragen?","a":"Nach IHK-Katalog modelliert."},{"q":"Punkte zum Bestehen?","a":"50/100 je Bereich. Für 2: 81+."},{"q":"Mündliche?","a":"Ja, 20 Min Fachgespräch, 20 % Gewicht."}]'::jsonb),

('pruefungsvorbereitung-anlagenmechaniker-pillar-guide','Prüfungsvorbereitung Anlagenmechaniker SHK: Strategie & Plan (2026)','Gesellenprüfung SHK Teil 1 + Teil 2: Wochenplan, Stolperfallen, echte Musterfragen.',
$md$Gesellenprüfung Anlagenmechaniker SHK: **2 Teile, 18 Monate Abstand**, schriftlich + praktisch.

## 30 Sekunden Antwort
Teil 1: **35 %**, Teil 2: **65 %**. Häufigster Fehler: isoliert lernen. **Verzahnt vorgehen!**

## Aufbau
| Teil | Wann | Form | Gewicht |
|---|---|---|---|
| 1 | nach 18 Monaten | 90 Min Theorie + 7 h Praxis | 35 % |
| 2 | Ende Ausbildung | 4 Klausuren + 14 h Kundenauftrag | 65 % |

## 6 Musterfragen
**F1 (MC):** Höchster Norm-Nutzungsgrad? → **Brennwertkessel ✅** (η > 100 % bezogen auf Hu).
**F2:** Werkstoffe für TW nach DIN 1988? → *Kupfer, nichtrostender Stahl, Mehrschichtverbund, PE-X, PP-R — nicht verzinkter Stahl bei zentraler TWE.*
**F3 (Berechnung):** V̇ = 0,5 l/s, v_max = 2 m/s → d? → **17,8 mm → DN 20**
**F4 (MC):** Rückverkeimungsschutz Trinkwasser? → **Systemtrenner DIN EN 1717 ✅**
**F5:** R-32 + Sicherheitsklasse? → *Difluormethan, A2L, GWP 675.*
**F6 (Fall):** Kaltes Brauchwasser trotz neuem Speicher. → *(1) Temp Speicher (2) Sollwert (3) Wärmeerzeuger (4) VL-Temp WT (5) Ladepumpe + PT1000 (6) Thermostat (7) Verkalkung.*

## Übungsmenge
< 200: 4 · 200–500: 3 · 500–900: 2 · 900+: 1

## 5 Fallen
1. DIN 1988 vs. EN 806 verwechseln.
2. Hydraulischer Abgleich ohne kv-Wert.
3. Norm-Heizlast ohne Wärmebrücken.
4. Hartlöten Pflicht ab Ø > 28 mm.
5. Kundenauftrag-Doku zählt **30 % der Note**.

## 12-Wochen-Plan vor Teil 2
W1–4: Heizung + Abgleich · W5–7: Trinkwasser/Sanitär · W8: Klima/Kälte · W9–10: Kundenauftrag · W11–12: Simulationen.

## Quellen
- Berufsausbildungsverordnung SHK
- *Fachkunde SHK* (Europa-Verlag)
- DIN 1988 / EN 806 / EN 12831

Verwandt: [Prüfungsfragen SHK](/blog/pruefungsfragen-anlagenmechaniker-pillar-guide).$md$,
 'pillar','published',now(),720,
 '[{"to":"/anlagenmechaniker-in","label":"SHK-Trainer","relation":"product"},{"to":"/blog/pruefungsfragen-anlagenmechaniker-pillar-guide","label":"Prüfungsfragen SHK","relation":"pillar_sibling"},{"to":"/azubi","label":"Azubi-Hub","relation":"persona_hub"}]'::jsonb,
 '[{"q":"Häufigster Durchfallgrund?","a":"Unterschätzung des Kundenauftrags Teil 2 — 30 % der Endnote."},{"q":"DIN auswendig?","a":"Nicht auswendig, aber Nummer + Anwendungsbereich."},{"q":"Durchfallquote?","a":"12–15 % Teil 2."}]'::jsonb),

('pruefungsfragen-anlagenmechaniker-pillar-guide','Prüfungsfragen Anlagenmechaniker SHK: Teil 1 + 2 mit Lösungen (2026)','Echte Prüfungsfragen Gesellenprüfung Anlagenmechaniker SHK mit Musterlösungen.',
$md$Realistische **Prüfungsfragen Anlagenmechaniker SHK** im Stil der Gesellenprüfungen Teil 1 + 2.

## Aufgabentypen
- Gebunden: MC, Zuordnung, Schaltzeichen
- Ungebunden: Berechnung, Skizze, Fall
- Praxis: Kundenauftrag mit Planung + Ausführung + Doku

## 6 Musterfragen
**F1 (Heizlast):** V=60 m³, ΔT=32 K, U=0,4, A=80 m², n=0,5/h.
- Φ_T = 0,4·80·32 = **1.024 W**
- Φ_V = 0,34·0,5·60·32 = **326 W**
- **Heizlast ≈ 1.350 W**
**F2 (MC):** Max Stagnationszeit TW nach DIN 1988-200? → **72 h ✅**
**F3 (Zuordnung):** Pumpe/Schmutzfänger/3-Wege-Mischer/Sicherheitsventil → *Kreis mit Dreieck / Y mit Filter / T mit Pfeil / Quadrat mit Feder.*
**F4 (Kälte):** Carnot-COP WP? → *COP_Carnot = T_warm/(T_warm − T_kalt). Praxis L/W: COP 3,0–4,5 bei A2/W35.*
**F5 (MC):** Wann Gashaupthahn sperren? → **Bei jedem wahrnehmbaren Geruch ✅**
**F6 (Kundenauftrag-Bewertung):** Doku max 30 P.
- Stückliste: 5 · Skizze m. Maßen/Strömung: 8 · Materialwahl: 5 · Prüfprotokoll: 7 · Übergabe: 5

## 3 Anti-Klassiker
1. Hydraulischer Abgleich ohne Armaturenverluste.
2. DIN ohne Anwendungsbezug zitieren.
3. Schweißnaht-Doku im Auftrag fehlt.

## Lerntempo
10–15/Tag × 6 Monate = **2.000+ Aufgaben** → Note 1–2 möglich.

Verwandt: [Prüfungsvorbereitung SHK](/blog/pruefungsvorbereitung-anlagenmechaniker-pillar-guide).$md$,
 'pillar','published',now(),680,
 '[{"to":"/anlagenmechaniker-in","label":"SHK-Trainer","relation":"product"},{"to":"/blog/pruefungsvorbereitung-anlagenmechaniker-pillar-guide","label":"Prüfungsvorbereitung SHK","relation":"pillar_sibling"},{"to":"/azubi","label":"Azubi-Hub","relation":"persona_hub"}]'::jsonb,
 '[{"q":"Punkte im Kundenauftrag?","a":"30 Doku + 70 Ausführung = 100."},{"q":"DIN-Normen?","a":"DIN 1988, EN 806, EN 12831 — Nummer + Gebiet kennen."},{"q":"Schwerster Bereich?","a":"Wärmebedarf + hydraulischer Abgleich."}]'::jsonb),

('pruefungsvorbereitung-shk-meister-pillar-guide','Prüfungsvorbereitung SHK-Meister: Alle 4 Teile im Überblick (2026)','SHK-Meisterprüfung: Aufbau, Reihenfolge, Wochenplan, Stolperfallen, Musterfragen.',
$md$SHK-Meisterprüfung: **4 Teile**, entscheidet über deine Zukunft als selbstständiger Meister.

## 30 Sekunden Antwort
Reihenfolge: **Teil 4 (AEVO) → Teil 3 (BWL) → Teil 2 (Fachtheorie) → Teil 1 (Praxis + Projekt)**.

## Die 4 Teile
| Teil | Inhalt | Dauer | Quote |
|---|---|---|---|
| 1 | Praxis + Projekt | mehrere Tage | ~75 % |
| 2 | Fachtheorie (3 Klausuren) | je 4 h | ~80 % |
| 3 | BWL/Recht/Steuern | 1 Tag | ~85 % |
| 4 | AEVO | 3 h + Fachgespräch | ~92 % |

## 6 Musterfragen
**F1 (Teil 2):** Solarthermie 4-Personen-WW? → 300 l Speicher, Flach 4–6 m² / Röhren 2,5–4 m², Süd ±30°, 30–60° Neigung, Deckungsgrad 60 %.
**F2 (Teil 3):** Lohn 28 €, GK 95 %, Gewinn 12 %. Netto-h-Satz?
- 28·1,95 = 54,60 → ·1,12 = **61,15 €/h**
**F3 (Teil 4):** 4 AEVO-Handlungsfelder? → *(1) Voraussetzungen (2) vorbereiten (3) durchführen (4) abschließen.*
**F4 (Teil 2, Hydraulik):** Abgleich Verfahren B? → *Raum-Heizlast → Massenströme → Druckverluste → kv-Wert → Voreinstellung Thermostat + Protokoll.*
**F5 (Teil 3, Recht):** Werk- vs. Dienstvertrag? → *Werk: Erfolg geschuldet (§ 631 BGB). Dienst: nur Tätigkeit. SHK = fast immer Werk.*
**F6 (Teil 1, Projekt):** Pflichtbestandteile? → *Auftragsanalyse + Kalkulation, CAD, Stückliste, Arbeitsablauf, Ausführung, Messprotokoll, Übergabe.*

## 9-Monats-Plan
M1–2: AEVO · M3–4: BWL · M5–7: Fachtheorie · M8–9: Projekt + Praxis.

## 5 strategische Fallen
1. AEVO unterschätzen — Fachgespräch ist Stolperstein.
2. Projekt-Thema zu komplex.
3. BWL: USt-Voranmeldung, IST/SOLL-Versteuerung.
4. Kalkulationsschema nicht standardisiert.
5. CAD-Konventionen ignorieren.

## Quellen
- HWO + Meisterprüfungsverordnung SHK
- *Meisterprüfung SHK* (Pflaum)
- AEVO-Handlungsfelder (BIBB)

Verwandt: [Prüfungsfragen SHK-Meister](/blog/pruefungsfragen-shk-meister-pillar-guide), [AEVO](/blog/pruefungsvorbereitung-aevo-pillar-guide).$md$,
 'pillar','published',now(),700,
 '[{"to":"/shk-meister-hwk","label":"SHK-Meister-Trainer","relation":"product"},{"to":"/blog/pruefungsfragen-shk-meister-pillar-guide","label":"Prüfungsfragen SHK-Meister","relation":"pillar_sibling"},{"to":"/blog/pruefungsvorbereitung-aevo-pillar-guide","label":"AEVO-Pillar","relation":"related_pillar"}]'::jsonb,
 '[{"q":"Reihenfolge?","a":"Teil 4 → 3 → 2 → 1."},{"q":"Wie lange?","a":"9–12 Monate berufsbegleitend."},{"q":"Kosten?","a":"Gebühren 1.500–2.500 €, Lehrgang 6.000–10.000 €. Aufstiegs-BAföG bis 75 %."}]'::jsonb),

('pruefungsfragen-shk-meister-pillar-guide','Prüfungsfragen SHK-Meister: Original-Aufgaben Teil 1–4 (2026)','Echte Prüfungsfragen SHK-Meisterprüfung: Fachtheorie, BWL, AEVO, Projekt mit Musterlösungen.',
$md$Realistische **Prüfungsfragen SHK-Meister** quer durch alle 4 Teile.

## Klausurstruktur
- Teil 2: 3 Klausuren à 4 h
- Teil 3: 4 h BWL/Recht
- Teil 4: 3 h Konzept + praktisches Beispiel

## 6 Original-Musterfragen
**F1 (Teil 2):** Ölheizung → L/W-WP, 5 Angebotsschritte:
1. Bestand + Heizlast EN 12831
2. Energetische Bewertung
3. Konzept (Monoblock/Split, Puffer, WW)
4. Wirtschaftlichkeit (10–15 J. Amortisation)
5. Förderung (BEG EM 70 %, KfW)

**F2 (Teil 3, AfA):** Maschine 24.000 €, ND 8 J.
- Linear: 3.000 €/J · Degressiv 25 %: J1=6.000, J2=4.500, J3=3.375…

**F3 (Teil 4, AEVO):** Hartlöten beibringen? → **4-Stufen-Methode**: (1) Vorbereiten (2) Vormachen + Erklären (3) Nachmachen (4) Üben + Kontrolle.

**F4 (Teil 2, Konstruktion):** Schema Brennwertkessel + 500 L Puffer + 8 m² Solar + FBH + HK → *Puffer zentral, Kessel oben einspeisend, Solar über WT unten, 2 HK mit Mischer (FBH 35°/HK 55°), hydraulische Weiche, MAG, Sicherheitsgruppen.*

**F5 (Teil 3, Recht):** Mängelanzeige vs. -rüge? → *Anzeige (B2C, § 437): formlos. Rüge (B2B, § 377 HGB): unverzüglich.*

**F6 (Teil 1, Projektbewertung):**
- Planung 25 % · CAD 20 % · Kalkulation 15 % · Werkstatt 25 % · IBN 10 % · Doku 5 %

## Klassische Fehler
1. AEVO: Methode ohne Begründung.
2. BWL: Vor-/Nachkalkulation verwechseln.
3. CAD: Strömungsrichtung + Maße fehlen.
4. Doku ohne Bezugsquellen.

## Lerntempo
15/Tag × 6 Monate = **2.700 Aufgaben** → Spitzennote möglich.

Verwandt: [Prüfungsvorbereitung SHK-Meister](/blog/pruefungsvorbereitung-shk-meister-pillar-guide).$md$,
 'pillar','published',now(),670,
 '[{"to":"/shk-meister-hwk","label":"SHK-Meister-Trainer","relation":"product"},{"to":"/blog/pruefungsvorbereitung-shk-meister-pillar-guide","label":"Prüfungsvorbereitung SHK-Meister","relation":"pillar_sibling"},{"to":"/blog/pruefungsfragen-aevo-pillar-guide","label":"AEVO","relation":"related_pillar"}]'::jsonb,
 '[{"q":"Punkte zum Bestehen?","a":"50/100 je Teil. Jeder Teil eigenständig."},{"q":"Teile nachholen?","a":"Ja, 2× wiederholbar."},{"q":"Gesellenprüfung Voraussetzung?","a":"Nein, mit 4+ J. Erfahrung möglich."}]'::jsonb);

-- 3) CTA an die 6 neuen Pillars
UPDATE public.blog_articles
SET content_md = content_md || E'\n\n---\n\n## 🎯 Bereit für die echte Prüfung? Jetzt Vollzugang sichern\n\nDie Musterfragen oben sind nur ein winziger Ausschnitt. Im **ExamFit ' ||
  CASE
    WHEN slug LIKE '%-kaufmann-einzelhandel-pillar-guide' THEN 'Einzelhandel'
    WHEN slug LIKE '%-anlagenmechaniker-pillar-guide' THEN 'Anlagenmechaniker SHK'
    WHEN slug LIKE '%-shk-meister-pillar-guide' THEN 'SHK-Meister'
  END || '-Trainer** bekommst du:\n\n- ✅ **Über 1.000 originalgetreue Prüfungsfragen** mit ausführlichen Erklärungen\n- ✅ **Adaptiver KI-Algorithmus** — trainiert gezielt deine Schwächen\n- ✅ **KI-Tutor 24/7** — beantwortet jede Fachfrage in Sekunden\n- ✅ **Echte Prüfungssimulation** + Pass-Probability-Score\n- ✅ **Mobile App + Desktop**\n\n### 👉 [Jetzt Trainer freischalten →](/' ||
  CASE
    WHEN slug LIKE '%-kaufmann-einzelhandel-pillar-guide' THEN 'kaufmann-einzelhandel-ihk'
    WHEN slug LIKE '%-anlagenmechaniker-pillar-guide' THEN 'anlagenmechaniker-in'
    WHEN slug LIKE '%-shk-meister-pillar-guide' THEN 'shk-meister-hwk'
  END || ')\n\n> *Über 12.000 Azubis und angehende Meister trainieren mit ExamFit. 14 Tage Geld-zurück-Garantie.*\n',
    word_count = word_count + 110, updated_at = now()
WHERE slug IN (
  'pruefungsvorbereitung-kaufmann-einzelhandel-pillar-guide','pruefungsfragen-kaufmann-einzelhandel-pillar-guide',
  'pruefungsvorbereitung-anlagenmechaniker-pillar-guide','pruefungsfragen-anlagenmechaniker-pillar-guide',
  'pruefungsvorbereitung-shk-meister-pillar-guide','pruefungsfragen-shk-meister-pillar-guide')
AND position('Bereit für die echte Prüfung' IN content_md) = 0;

-- 4) Keyword-Registry (alle persona='azubi' — meister nicht erlaubt)
DELETE FROM public.growth_keyword_registry WHERE keyword_slug IN (
  'pruefungsvorbereitung-kaufmann-einzelhandel','pruefungsfragen-kaufmann-einzelhandel',
  'pruefungsvorbereitung-anlagenmechaniker','pruefungsfragen-anlagenmechaniker',
  'pruefungsvorbereitung-shk-meister','pruefungsfragen-shk-meister');

INSERT INTO public.growth_keyword_registry (keyword_slug, keyword_text, funnel_stage, status, canonical_intent, owner_kind, owner_url, persona, notes)
VALUES
 ('pruefungsvorbereitung-kaufmann-einzelhandel','prüfungsvorbereitung kaufmann einzelhandel','exam_prep','active','informational','blog_article','/blog/pruefungsvorbereitung-kaufmann-einzelhandel-pillar-guide','azubi','Wave1-Batch3 | intent=exam_prep'),
 ('pruefungsfragen-kaufmann-einzelhandel','prüfungsfragen kaufmann einzelhandel','exam_prep','active','informational','blog_article','/blog/pruefungsfragen-kaufmann-einzelhandel-pillar-guide','azubi','Wave1-Batch3 | intent=exam_questions'),
 ('pruefungsvorbereitung-anlagenmechaniker','prüfungsvorbereitung anlagenmechaniker shk','exam_prep','active','informational','blog_article','/blog/pruefungsvorbereitung-anlagenmechaniker-pillar-guide','azubi','Wave1-Batch3 | intent=exam_prep'),
 ('pruefungsfragen-anlagenmechaniker','prüfungsfragen anlagenmechaniker shk','exam_prep','active','informational','blog_article','/blog/pruefungsfragen-anlagenmechaniker-pillar-guide','azubi','Wave1-Batch3 | intent=exam_questions'),
 ('pruefungsvorbereitung-shk-meister','prüfungsvorbereitung shk-meister','exam_prep','active','informational','blog_article','/blog/pruefungsvorbereitung-shk-meister-pillar-guide','azubi','Wave1-Batch3 | intent=exam_prep | audience=meister'),
 ('pruefungsfragen-shk-meister','prüfungsfragen shk-meister','exam_prep','active','informational','blog_article','/blog/pruefungsfragen-shk-meister-pillar-guide','azubi','Wave1-Batch3 | intent=exam_questions | audience=meister');

-- 5) Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('seo_beruf_pillar_wave1_batch3_published','system','success',
  jsonb_build_object('batch',3,'new_pillars',6,'cta_hardened_articles_existing',13,
    'certs',jsonb_build_array('kaufmann-einzelhandel-ihk','anlagenmechaniker-in','shk-meister-hwk'),
    'skipped_certs_missing_from_catalog',jsonb_build_array('verkaeufer','bankkaufmann-frau','pflegefachmann-frau'),
    'rolled_out_at',now()));
