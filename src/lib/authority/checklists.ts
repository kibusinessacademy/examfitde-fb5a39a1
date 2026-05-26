/**
 * Deterministische Checklisten-Daten (frontend-only, druckbar).
 * Slug = `${topic}-${assetSlug}` aus catalog.ts referenziert hier.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  detail?: string;
  legal?: string;
}

export interface ChecklistDoc {
  slug: string;
  topicSlug: string;
  title: string;
  intro: string;
  items: ChecklistItem[];
  source: string;
  metaDescription: string;
}

export const CHECKLISTS: ChecklistDoc[] = [
  {
    slug: "kuendigung-arbeitgeber",
    topicSlug: "kuendigung",
    title: "Checkliste: Kündigung durch Arbeitgeber",
    metaDescription:
      "12-Schritte-Checkliste für eine rechtssichere Arbeitgeber-Kündigung — Anhörung, Frist, Form, Zustellung, Folgen.",
    intro:
      "Eine fehlerhafte Kündigung kostet im Schnitt 3–9 Monatsgehälter Abfindung. Diese Checkliste verhindert die häufigsten Formfehler.",
    source: "§§622, 623 BGB · §102 BetrVG · §1 KSchG",
    items: [
      { id: "1", label: "Kündigungsgrund dokumentieren", detail: "Personenbedingt, verhaltensbedingt, betriebsbedingt — Belege sichern." },
      { id: "2", label: "Abmahnung(en) vorhanden?", detail: "Bei verhaltensbedingt: i.d.R. mindestens 1 einschlägige Abmahnung.", legal: "§314 II BGB" },
      { id: "3", label: "Sozialauswahl prüfen", detail: "Bei betriebsbedingt: Alter, Betriebszugehörigkeit, Unterhalt, Schwerbehinderung.", legal: "§1 III KSchG" },
      { id: "4", label: "Betriebsrat anhören", detail: "Vollständige Anhörung VOR Ausspruch — 1 Woche Frist.", legal: "§102 BetrVG" },
      { id: "5", label: "Sonderkündigungsschutz prüfen", detail: "Schwangerschaft (§17 MuSchG), Elternzeit, Schwerbehinderung (§168 SGB IX), Betriebsrat (§15 KSchG)." },
      { id: "6", label: "Frist berechnen", detail: "§622 BGB oder Tarif/Arbeitsvertrag — den jeweils günstigeren Wert für AN." },
      { id: "7", label: "Schriftform sicherstellen", detail: "Eigenhändige Originalunterschrift, kein Fax/E-Mail/Scan.", legal: "§623 BGB" },
      { id: "8", label: "Vertretungsmacht klären", detail: "Wer unterzeichnet? Vollmacht beifügen, sonst Zurückweisungsrisiko §174 BGB." },
      { id: "9", label: "Nachweisbar zustellen", detail: "Persönliche Übergabe mit Zeugen ODER Einschreiben/Eigenhändig + Boten." },
      { id: "10", label: "Resturlaub/Überstunden klären", detail: "Freistellung mit/ohne Anrechnung schriftlich regeln." },
      { id: "11", label: "Arbeitspapiere vorbereiten", detail: "Zeugnis, Sozialversicherung, ELStAM, Urlaubsbescheinigung." },
      { id: "12", label: "Klagefrist beachten", detail: "AN hat 3 Wochen Klagefrist — danach Wirksamkeitsfiktion.", legal: "§4 KSchG" },
    ],
  },
  {
    slug: "ausbildung-onboarding",
    topicSlug: "ausbildung",
    title: "Checkliste: Azubi-Onboarding (BBiG-konform)",
    metaDescription:
      "Checkliste für ein rechtssicheres Azubi-Onboarding — Vertrag, IHK, Berichtsheft, Ausbildungsplan, Probezeit.",
    intro:
      "Onboarding entscheidet über Abbruch oder Bindung. Diese 11 Schritte decken alle BBiG-Pflichten ab.",
    source: "§§10–14, 20 BBiG · §2 NachweisG",
    items: [
      { id: "1", label: "Ausbildungsvertrag schriftlich abschließen", legal: "§11 BBiG" },
      { id: "2", label: "Vertrag bei IHK/HWK eintragen", detail: "Vor Ausbildungsbeginn — sonst kein Anspruch auf Prüfungszulassung." },
      { id: "3", label: "Eignung Ausbildungsstätte/Ausbilder dokumentieren", legal: "§§27–30 BBiG" },
      { id: "4", label: "Betrieblicher Ausbildungsplan erstellen", legal: "§14 I Nr. 1 BBiG" },
      { id: "5", label: "Berichtsheft bereitstellen + Führung erklären", legal: "§14 II BBiG" },
      { id: "6", label: "Arbeitsmittel & Schutzausrüstung kostenlos stellen", legal: "§14 I Nr. 3 BBiG" },
      { id: "7", label: "Berufsschulanmeldung sicherstellen" },
      { id: "8", label: "Datenschutz-Information übergeben (Art. 13 DSGVO)" },
      { id: "9", label: "Probezeit-Review im 3. Monat ansetzen", detail: "1–4 Monate Probezeit (§20 BBiG)." },
      { id: "10", label: "Mentor/Pate festlegen" },
      { id: "11", label: "Erstgespräch mit Erziehungsberechtigten (bei Minderjährigen)" },
    ],
  },
  {
    slug: "zeiterfassung-pflicht",
    topicSlug: "arbeitszeit",
    title: "Checkliste: Pflicht-Zeiterfassung umsetzen",
    metaDescription:
      "Seit BAG 13.09.2022: systematische Arbeitszeiterfassung Pflicht. Checkliste für rechtskonforme Umsetzung.",
    intro:
      "Das BAG hat die Pflicht zur Arbeitszeiterfassung bestätigt — auch ohne explizite Gesetzesnovellierung gilt §3 ArbSchG i.V.m. EuGH-Urteil unmittelbar.",
    source: "BAG 1 ABR 22/21 · §3 ArbSchG · EuGH C-55/18",
    items: [
      { id: "1", label: "Status-Quo dokumentieren (heutige Erfassung)" },
      { id: "2", label: "System wählen (analog/digital/Hybrid)" },
      { id: "3", label: "Betriebsrat beteiligen (§87 I Nr. 6 BetrVG)" },
      { id: "4", label: "Datenschutz-Folgenabschätzung (Art. 35 DSGVO)" },
      { id: "5", label: "Arbeitsverträge / Richtlinie anpassen" },
      { id: "6", label: "Beschäftigte schulen + informieren" },
      { id: "7", label: "Vertrauensarbeitszeit-Modell klären (Erfassung bleibt Pflicht!)" },
      { id: "8", label: "Mobile/Außendienst-Erfassung sicherstellen" },
      { id: "9", label: "Aufbewahrungsfristen festlegen (2 Jahre §16 II ArbZG)" },
      { id: "10", label: "Audit-Routine (monatliche Plausibilitätsprüfung)" },
    ],
  },
  {
    slug: "bewerberdaten-loeschung",
    topicSlug: "compliance-dsgvo",
    title: "Checkliste: Bewerberdaten DSGVO-konform löschen",
    metaDescription:
      "Bewerberdaten nach 6 Monaten löschen — AGG-Reserve, Talent-Pool nur mit Einwilligung, Lösch-Protokoll.",
    intro:
      "Bewerberdaten sind nach Zweckerfüllung zu löschen (Art. 17 DSGVO). 6 Monate AGG-Reserve gelten als Standard.",
    source: "Art. 17 DSGVO · §15 IV AGG · §26 BDSG",
    items: [
      { id: "1", label: "Lösch-Konzept dokumentieren (Wann/Was/Wer)" },
      { id: "2", label: "Standard-Frist 6 Monate ab Absage einhalten" },
      { id: "3", label: "Talent-Pool-Aufnahme nur mit aktiver Einwilligung" },
      { id: "4", label: "Einwilligungs-Widerruf jederzeit ermöglichen" },
      { id: "5", label: "Bewerber-Tracking-Tools auf DSGVO prüfen" },
      { id: "6", label: "Lösch-Protokoll führen (Rechenschaftspflicht Art. 5 II DSGVO)" },
      { id: "7", label: "Auftragsverarbeiter-Verträge (Art. 28 DSGVO) prüfen" },
      { id: "8", label: "Backup-Lösch-Routine im IT-Betrieb verankern" },
    ],
  },
  {
    slug: "nachweisg-pflichten",
    topicSlug: "vertrag",
    title: "Checkliste: NachweisG-Pflichten am 1. Arbeitstag",
    metaDescription:
      "Seit 01.08.2022: 15 Pflicht-Angaben schriftlich am ersten Arbeitstag. Bußgeld bis 2.000 € pro Verstoß.",
    intro:
      "Das NachweisG verlangt schriftliche Übergabe wesentlicher Vertragsbedingungen. Verstöße werden mit bis zu 2.000 € pro Fall geahndet (§4 NachweisG).",
    source: "§2 NachweisG (Fassung 01.08.2022)",
    items: [
      { id: "1", label: "Name + Anschrift Arbeitgeber/Arbeitnehmer" },
      { id: "2", label: "Beginn des Arbeitsverhältnisses" },
      { id: "3", label: "Bei Befristung: Enddatum / vorhersehbare Dauer" },
      { id: "4", label: "Arbeitsort (oder Hinweis auf wechselnd)" },
      { id: "5", label: "Tätigkeitsbeschreibung" },
      { id: "6", label: "Dauer der Probezeit (falls vereinbart)" },
      { id: "7", label: "Zusammensetzung & Höhe des Arbeitsentgelts" },
      { id: "8", label: "Arbeitszeit + ggf. Schichtsystem/Bereitschaft" },
      { id: "9", label: "Urlaubsanspruch" },
      { id: "10", label: "Fortbildungsanspruch (falls bestehend)" },
      { id: "11", label: "Bei Altersversorgung: Versorgungseinrichtung" },
      { id: "12", label: "Verfahren bei Kündigung (Schriftform, Frist, Klagefrist)" },
      { id: "13", label: "Hinweis auf anwendbare Tarifverträge/Betriebsvereinbarungen" },
      { id: "14", label: "Überstunden-Regelung (Anordnung, Vergütung)" },
      { id: "15", label: "Identität von Entleiher (bei Leiharbeit)" },
    ],
  },
];

export function findChecklist(slug: string): ChecklistDoc | undefined {
  return CHECKLISTS.find((c) => c.slug === slug);
}
