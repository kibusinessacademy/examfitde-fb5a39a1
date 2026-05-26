/**
 * Vorlagen-Texte (deterministisch, copy-/downloadbar als .txt).
 * Bewusst keine PDF-Pipeline — Frontend-only, Plain-Text.
 */

export interface TemplateDoc {
  slug: string;
  topicSlug: string;
  title: string;
  intro: string;
  metaDescription: string;
  source: string;
  /** Markdown-Body, wird im UI als <pre> + Copy/Download exponiert. */
  body: string;
}

export const TEMPLATES: TemplateDoc[] = [
  {
    slug: "kuendigungsschreiben",
    topicSlug: "kuendigung",
    title: "Vorlage: Kündigungsschreiben (ordentlich)",
    metaDescription:
      "Vorlage Kündigungsschreiben Arbeitgeber — Schriftform §623 BGB, Empfangsbestätigung, Freistellung, Urlaub.",
    source: "§§622, 623 BGB",
    intro:
      "Diese Vorlage erfüllt die Schriftform nach §623 BGB. Eigenhändige Originalunterschrift ist zwingend — kein Fax, kein Scan, keine E-Mail.",
    body: `[Arbeitgeber-Briefkopf]

[Vor- und Nachname Mitarbeiter:in]
[Anschrift]

[Ort], [Datum]

Beendigung des Arbeitsverhältnisses

Sehr geehrte/r Frau/Herr [Nachname],

hiermit kündigen wir das zwischen Ihnen und uns bestehende
Arbeitsverhältnis ordentlich und fristgerecht zum

      [Beendigungsdatum].

Die Kündigungsfrist ergibt sich aus [§622 BGB / §[ ] Arbeitsvertrag /
Tarifvertrag [ ]]. Sollte das Arbeitsverhältnis zu diesem Zeitpunkt
nicht beendet werden können, gilt die Kündigung zum nächstmöglichen
Termin.

Resturlaub: Sie werden ab dem [Datum] unter Anrechnung Ihres
verbleibenden Urlaubsanspruchs von [X] Tagen unwiderruflich von der
Arbeitsleistung freigestellt.

Bitte melden Sie sich gemäß §38 SGB III unverzüglich, spätestens drei
Monate vor Beendigung des Arbeitsverhältnisses, persönlich bei der
zuständigen Agentur für Arbeit arbeitsuchend.

Wir danken Ihnen für die geleistete Arbeit und wünschen Ihnen für Ihre
berufliche und persönliche Zukunft alles Gute.

Mit freundlichen Grüßen

___________________________
[Name, Funktion, eigenhändige Unterschrift]


Empfangsbestätigung
Das Original dieses Kündigungsschreibens habe ich am [Datum] erhalten.

[Ort, Datum]                  ___________________________
                              [Unterschrift Mitarbeiter:in]
`,
  },
  {
    slug: "ausbildungsplan",
    topicSlug: "ausbildung",
    title: "Vorlage: Betrieblicher Ausbildungsplan",
    metaDescription:
      "Vorlage Betrieblicher Ausbildungsplan nach §14 BBiG — Lernfeld-Struktur, Quartalsmeilensteine, Beurteilung.",
    source: "§14 I Nr. 1 BBiG",
    intro:
      "Der betriebliche Ausbildungsplan ist Pflicht nach §14 BBiG. Diese Vorlage strukturiert nach Ausbildungsjahren und Quartalen.",
    body: `BETRIEBLICHER AUSBILDUNGSPLAN

Beruf:              [z.B. Fachinformatiker/in Systemintegration]
Ausbildungsbeginn:  [Datum]
Ausbildungsdauer:   [3 Jahre]
Ausbildende/r:      [Name + Eignung nach §28 BBiG]

----------------------------------------------------------------
1. Ausbildungsjahr
----------------------------------------------------------------
Q1 (Mon. 1–3)
  - Onboarding, Betriebsorganisation, Sicherheit
  - Lernfeld 1: [...]
  - Berichtsheft-Routine etablieren

Q2 (Mon. 4–6)
  - Lernfeld 2: [...]
  - Probezeit-Review (Mon. 4) — §20 BBiG

Q3 (Mon. 7–9)
  - Lernfeld 3: [...]
  - Erste Abteilungsrotation

Q4 (Mon. 10–12)
  - Lernfeld 4: [...]
  - Jahresbeurteilung + Prüfung Zwischenprüfung

----------------------------------------------------------------
2. Ausbildungsjahr
----------------------------------------------------------------
Q1–Q2: Vertiefung Lernfelder 5–6, Projektarbeit
Q3:    Zwischenprüfung (Teil 1)
Q4:    Lernfeld 7, Wahlpflicht-Einsatz

----------------------------------------------------------------
3. Ausbildungsjahr
----------------------------------------------------------------
Q1: Vorbereitung Abschlussprüfung Teil 2
Q2: Prüfungsprojekt + Dokumentation
Q3: Abschlussprüfung
Q4: Übernahme-Gespräch

----------------------------------------------------------------
Beurteilungs-Raster (pro Quartal)
----------------------------------------------------------------
  - Fachkompetenz             (1–5)
  - Methodenkompetenz         (1–5)
  - Sozialkompetenz           (1–5)
  - Selbstkompetenz           (1–5)
  - Berichtsheft-Qualität     (1–5)

Unterschriften:  Ausbilder/in _______  Auszubildende/r _______
`,
  },
  {
    slug: "arbeitszeit-richtlinie",
    topicSlug: "arbeitszeit",
    title: "Vorlage: Arbeitszeit-Richtlinie",
    metaDescription:
      "Vorlage Arbeitszeit-Richtlinie — Höchstarbeitszeit, Pausen, Ruhezeit, Mehrarbeit, Vertrauensarbeitszeit.",
    source: "§§3–5 ArbZG",
    intro:
      "Diese Richtlinie regelt die werktägliche Arbeitszeit und ist mit dem Betriebsrat abzustimmen (§87 I Nr. 2 BetrVG).",
    body: `ARBEITSZEIT-RICHTLINIE

1. Geltungsbereich
   Alle Beschäftigten der [Firma]. Ausgenommen: Leitende Angestellte
   i.S.v. §5 III BetrVG.

2. Höchstarbeitszeit
   Werktäglich grundsätzlich 8 Stunden. Verlängerung auf bis zu 10
   Stunden zulässig, wenn innerhalb von 6 Kalendermonaten oder 24
   Wochen im Schnitt 8 Stunden werktäglich nicht überschritten werden
   (§3 ArbZG).

3. Pausen (§4 ArbZG)
   - >6 h Arbeit:  30 min Pause (in Blöcken ≥15 min)
   - >9 h Arbeit:  45 min Pause

4. Ruhezeit (§5 ArbZG)
   Mindestens 11 Stunden ununterbrochene Ruhezeit zwischen den
   Arbeitstagen.

5. Sonn- und Feiertagsarbeit
   Grundsätzlich verboten (§9 ArbZG). Ausnahmen nur in den in §10
   ArbZG genannten Fällen.

6. Zeiterfassung
   Sämtliche Arbeitszeit wird systematisch erfasst — gemäß
   BAG-Beschluss vom 13.09.2022 (1 ABR 22/21) und §3 ArbSchG.

7. Mehrarbeit
   Anordnung nur durch Vorgesetzte mit Personalverantwortung.
   Ausgleich primär in Freizeit, ersatzweise nach [Vergütungsmodell].

8. Vertrauensarbeitszeit (optional)
   Beschäftigte gestalten Lage der Arbeitszeit selbst — die Pflicht
   zur Erfassung bleibt bestehen.
`,
  },
  {
    slug: "datenschutz-arbeitnehmer",
    topicSlug: "compliance-dsgvo",
    title: "Vorlage: Datenschutz-Information für Beschäftigte (Art. 13 DSGVO)",
    metaDescription:
      "Vorlage Datenschutz-Information Mitarbeiter — Art. 13 DSGVO-konforme Information bei Einstellung.",
    source: "Art. 13 DSGVO · §26 BDSG",
    intro:
      "Bei Einstellung ist eine Information nach Art. 13 DSGVO zu übergeben. Diese Vorlage deckt die Pflichtangaben ab.",
    body: `DATENSCHUTZ-INFORMATION FÜR BESCHÄFTIGTE
(Art. 13 DSGVO)

1. Verantwortlicher
   [Firma, Anschrift, Vertreter, Kontakt]

2. Datenschutzbeauftragter
   [Name, E-Mail]

3. Zwecke und Rechtsgrundlagen
   a) Begründung, Durchführung, Beendigung des Arbeitsverhältnisses
      — §26 I BDSG
   b) Lohn-/Gehaltsabrechnung, Sozialversicherung
      — Art. 6 I c DSGVO i.V.m. §28a SGB IV
   c) IT-Bereitstellung und IT-Sicherheit
      — Art. 6 I f DSGVO
   d) Erfüllung rechtlicher Pflichten (Steuern, AGG-Reserven)
      — Art. 6 I c DSGVO

4. Datenkategorien
   Stammdaten, Vertragsdaten, Vergütung, Qualifikation, Arbeitszeit,
   Leistungsdaten, IT-Nutzungsdaten (im engen Rahmen).

5. Empfänger
   Sozialversicherung, Finanzamt, Berufsgenossenschaft, ggf.
   Auftragsverarbeiter (Lohn, IT) auf Basis Art. 28 DSGVO.

6. Speicherdauer
   Während des Arbeitsverhältnisses + gesetzliche Aufbewahrungsfristen
   (idR 10 Jahre Steuer/HGB, 6 Jahre Lohn).

7. Betroffenenrechte
   Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch,
   Datenübertragbarkeit, Beschwerde bei Aufsichtsbehörde.

8. Pflicht zur Bereitstellung
   Bestimmte Daten sind gesetzlich/vertraglich erforderlich — ohne
   ihre Bereitstellung ist das Arbeitsverhältnis nicht durchführbar.

[Ort, Datum]  ___________________________
              [Empfangsbestätigung Beschäftigte/r]
`,
  },
  {
    slug: "arbeitsvertrag-standard",
    topicSlug: "vertrag",
    title: "Vorlage: Arbeitsvertrag (unbefristet, NachweisG-konform)",
    metaDescription:
      "Vorlage Arbeitsvertrag unbefristet, NachweisG-konform — 15 Pflichtangaben, Probezeit, Kündigungsfrist.",
    source: "§2 NachweisG · §622 BGB",
    intro:
      "Diese Vorlage enthält alle 15 NachweisG-Pflichtangaben. Anpassung an Branche/Tarif erforderlich.",
    body: `ARBEITSVERTRAG

zwischen [Firma, Anschrift] — "Arbeitgeber" —
und     [Vor-/Nachname, Anschrift] — "Arbeitnehmer/in" —

§1 Beginn, Probezeit
   (1) Das Arbeitsverhältnis beginnt am [Datum] und wird auf
       unbestimmte Zeit geschlossen.
   (2) Die ersten 6 Monate gelten als Probezeit. Während dieser kann
       beidseitig mit einer Frist von 2 Wochen gekündigt werden
       (§622 III BGB).

§2 Tätigkeit, Arbeitsort
   (1) Tätigkeit: [Beschreibung].
   (2) Arbeitsort: [Anschrift] — der Arbeitgeber behält sich vor, eine
       andere zumutbare Tätigkeit an einem anderen Ort zuzuweisen.

§3 Arbeitszeit
   (1) Wöchentliche Arbeitszeit: [40] Stunden, Mo–Fr.
   (2) Pausen und Ruhezeiten richten sich nach dem ArbZG.
   (3) Arbeitszeit wird systematisch erfasst (§3 ArbSchG).

§4 Vergütung
   (1) Bruttogehalt: [X] € monatlich, zahlbar am Monatsende.
   (2) Zusatzleistungen: [...].

§5 Urlaub
   [30] Werktage pro Kalenderjahr (bei 5-Tage-Woche).

§6 Krankheit
   Anzeige unverzüglich, AU-Bescheinigung ab dem 4. Krankheitstag.

§7 Kündigung
   (1) Nach der Probezeit gilt §622 BGB.
   (2) Schriftform §623 BGB — eigenhändige Unterschrift.
   (3) Klagefrist 3 Wochen (§4 KSchG).

§8 Verschwiegenheit, Wettbewerb
   [optionale Klauseln]

§9 Tarifverträge / Betriebsvereinbarungen
   Anwendbar sind: [...].

§10 Schlussbestimmungen
   Änderungen bedürfen der Schriftform. Salvatorische Klausel.

[Ort, Datum]
_________________________      _________________________
Arbeitgeber                    Arbeitnehmer/in
`,
  },
];

export function findTemplate(slug: string): TemplateDoc | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
