/**
 * Deterministische Risiko-Checks (Frontend-only, regelbasiert).
 * Keine AI, keine Backend-Calls — pure Funktionen über Fragebogen-Antworten.
 */

export type AnswerValue = "yes" | "no" | "unknown";

export interface RiskQuestion {
  id: string;
  label: string;
  /** Welche Antwort erhöht das Risiko? */
  risky: AnswerValue;
  /** Gewicht 1–3 (3 = K.O.-Kriterium). */
  weight: 1 | 2 | 3;
  hint?: string;
}

export interface RiskCheckDoc {
  slug: string;
  topicSlug: string;
  title: string;
  metaDescription: string;
  intro: string;
  questions: RiskQuestion[];
  source: string;
  /** Schwellen für Ampel. */
  thresholds: { green: number; amber: number };
  /** Empfehlungen pro Ampel. */
  recommendations: Record<"green" | "amber" | "red", string>;
}

export const RISK_CHECKS: RiskCheckDoc[] = [
  {
    slug: "kuendigungsschutz",
    topicSlug: "kuendigung",
    title: "Kündigungsschutz-Risiko-Check",
    metaDescription:
      "5 Fragen — Sofortbewertung: Greift KSchG? Wie hoch ist das Klage-Risiko? Mit Folge-Empfehlung.",
    intro:
      "Dieser Check schätzt das Risiko einer erfolgreichen Kündigungsschutzklage ein. Er ersetzt keine Rechtsberatung.",
    source: "§§1, 4, 23 KSchG",
    questions: [
      { id: "q1", label: "Ist der/die Beschäftigte länger als 6 Monate im Betrieb?", risky: "yes", weight: 3, hint: "Wartezeit §1 KSchG" },
      { id: "q2", label: "Hat der Betrieb mehr als 10 Vollzeit-Beschäftigte?", risky: "yes", weight: 3, hint: "Schwellwert §23 KSchG" },
      { id: "q3", label: "Liegt ein dokumentierter Kündigungsgrund (Person/Verhalten/Betrieb) vor?", risky: "no", weight: 3 },
      { id: "q4", label: "Wurde der Betriebsrat ordnungsgemäß angehört?", risky: "no", weight: 3, hint: "§102 BetrVG — sonst unwirksam" },
      { id: "q5", label: "Greift Sonderkündigungsschutz (Schwangerschaft/Eltern/Schwerbehinderung)?", risky: "yes", weight: 3 },
    ],
    thresholds: { green: 2, amber: 5 },
    recommendations: {
      green: "Risiko gering. Standard-Prozess (Anhörung → Frist → Schriftform → Zustellung) durchführen.",
      amber: "Risiko erhöht. Vor Ausspruch juristisch prüfen lassen und Sozialauswahl + Anhörung dokumentieren.",
      red: "Hohes Klage-Risiko. Aufhebungsvertrag oder Abfindungsmodell prüfen — Kündigung kann unwirksam sein.",
    },
  },
  {
    slug: "ausbildung-abbruch",
    topicSlug: "ausbildung",
    title: "Risiko-Check: Ausbildungsabbruch",
    metaDescription:
      "Frühindikatoren für drohenden Ausbildungsabbruch erkennen — 6 Fragen, sofortige Ampel + Maßnahme.",
    intro:
      "1 von 4 Ausbildungsverträgen wird vorzeitig gelöst. Dieser Check macht Risiko-Cluster sichtbar.",
    source: "BIBB-Datenreport · §22 BBiG",
    questions: [
      { id: "q1", label: "Berichtsheft seit >4 Wochen nicht aktualisiert?", risky: "yes", weight: 2 },
      { id: "q2", label: "Fehlzeiten Berufsschule >10%?", risky: "yes", weight: 2 },
      { id: "q3", label: "Mindestens 1 unentschuldigtes Fehlen im Betrieb (letzte 8 Wochen)?", risky: "yes", weight: 2 },
      { id: "q4", label: "Beurteilung sank im letzten Quartal um ≥1 Stufe?", risky: "yes", weight: 2 },
      { id: "q5", label: "Persönliches Gespräch (Mentor) länger als 8 Wochen her?", risky: "yes", weight: 1 },
      { id: "q6", label: "Soziale Belastung bekannt (Wohnen/Familie/Finanzen)?", risky: "yes", weight: 3 },
    ],
    thresholds: { green: 2, amber: 5 },
    recommendations: {
      green: "Stabile Ausbildung. Routine-Mentoring beibehalten.",
      amber: "Frühintervention: Mentor-Gespräch, Lernstands-Diagnose (ExamFit Heatmap), Maßnahmenplan.",
      red: "Akuter Handlungsbedarf: Krisengespräch + externe Beratung (IHK-Ausbildungsberater, Sozialdienst).",
    },
  },
  {
    slug: "arbeitszeit-compliance",
    topicSlug: "arbeitszeit",
    title: "Compliance-Check: Arbeitszeit",
    metaDescription:
      "10 Fragen — Sofortbewertung Bußgeld-Risiko nach §22 ArbZG (bis 30.000 €) und Pflicht-Zeiterfassung.",
    intro:
      "Verstöße gegen das ArbZG werden mit bis zu 30.000 € geahndet, bei Vorsatz bis 15.000 € pro Fall. Dieser Check macht Lücken sichtbar.",
    source: "ArbZG · §3 ArbSchG · BAG 1 ABR 22/21",
    questions: [
      { id: "q1", label: "Arbeitszeit wird für alle Beschäftigten systematisch erfasst?", risky: "no", weight: 3 },
      { id: "q2", label: "10-Stunden-Höchstgrenze (§3 ArbZG) wird eingehalten?", risky: "no", weight: 3 },
      { id: "q3", label: "Mindest-Pausen (§4 ArbZG) werden gewährt + erfasst?", risky: "no", weight: 2 },
      { id: "q4", label: "11 h Ruhezeit (§5 ArbZG) zwischen Schichten eingehalten?", risky: "no", weight: 2 },
      { id: "q5", label: "Sonn-/Feiertagsarbeit dokumentiert begründet (§10)?", risky: "no", weight: 1 },
      { id: "q6", label: "Schichtpläne ≥4 Wochen im Voraus kommuniziert?", risky: "no", weight: 1 },
      { id: "q7", label: "Mobile/Außendienst-Beschäftigte erfasst?", risky: "no", weight: 2 },
      { id: "q8", label: "Vertrauensarbeitszeit-Modelle mit Erfassung kombiniert?", risky: "no", weight: 2 },
      { id: "q9", label: "Betriebsrat-Mitbestimmung (§87 I Nr. 2/6 BetrVG) gewahrt?", risky: "no", weight: 2 },
      { id: "q10", label: "Datenschutz-Folgenabschätzung der Erfassung dokumentiert?", risky: "no", weight: 1 },
    ],
    thresholds: { green: 3, amber: 8 },
    recommendations: {
      green: "Compliance solide. Jährliches Audit + Aktualisierung Richtlinie ausreichend.",
      amber: "Lücken vorhanden. Innerhalb 60 Tagen: System wählen, Richtlinie aktualisieren, BR beteiligen.",
      red: "Hohes Bußgeld-Risiko (§22 ArbZG bis 30.000 €). Sofort-Maßnahmenplan + externe Beratung.",
    },
  },
  {
    slug: "hinschg-readiness",
    topicSlug: "compliance-dsgvo",
    title: "HinSchG-Readiness-Check",
    metaDescription:
      "Hinweisgeberschutzgesetz: Pflicht ab 50 Beschäftigten — 6 Fragen, sofortige Bewertung der Umsetzung.",
    intro:
      "Das HinSchG verpflichtet Unternehmen ab 50 Beschäftigten zu einer internen Meldestelle. Verstöße bis 50.000 €.",
    source: "§§12 ff. HinSchG",
    questions: [
      { id: "q1", label: "Mehr als 50 Beschäftigte im Unternehmen?", risky: "yes", weight: 3 },
      { id: "q2", label: "Interne Meldestelle eingerichtet (Telefon/Schriftlich/Persönlich)?", risky: "no", weight: 3 },
      { id: "q3", label: "Unparteiische Person/Funktion benannt?", risky: "no", weight: 2 },
      { id: "q4", label: "Vertraulichkeit der Identität sichergestellt?", risky: "no", weight: 3 },
      { id: "q5", label: "Bestätigung Eingang ≤7 Tage / Rückmeldung ≤3 Monate?", risky: "no", weight: 2 },
      { id: "q6", label: "Beschäftigte über Meldestelle informiert (Intranet/Aushang)?", risky: "no", weight: 1 },
    ],
    thresholds: { green: 2, amber: 6 },
    recommendations: {
      green: "HinSchG-konform. Jährliche Funktionsprüfung dokumentieren.",
      amber: "Umsetzung unvollständig — innerhalb 30 Tagen Meldestelle finalisieren.",
      red: "Hohes Bußgeld-Risiko (§40 HinSchG). Externe Lösung evaluieren oder sofort intern aufsetzen.",
    },
  },
  {
    slug: "befristung-risiko",
    topicSlug: "vertrag",
    title: "Risiko-Check: Befristung nach TzBfG",
    metaDescription:
      "Risiko Entfristungs-Klage — Sachgrund, Vorbeschäftigung, Höchstdauer. 6 Fragen, sofortige Bewertung.",
    intro:
      "Eine unwirksame Befristung führt zum unbefristeten Arbeitsverhältnis. Dieser Check macht typische Stolperfallen sichtbar.",
    source: "§14 TzBfG · BAG-Rspr.",
    questions: [
      { id: "q1", label: "Sachgrund vorhanden + dokumentiert (§14 I TzBfG)?", risky: "no", weight: 3 },
      { id: "q2", label: "Wenn sachgrundlos: Vorbeschäftigung beim selben AG ausgeschlossen?", risky: "no", weight: 3, hint: "BVerfG 2018: i.d.R. keine erneute sachgrundlose Befristung" },
      { id: "q3", label: "Wenn sachgrundlos: Höchstdauer ≤2 Jahre + max. 3 Verlängerungen?", risky: "no", weight: 3 },
      { id: "q4", label: "Befristung VOR Arbeitsaufnahme schriftlich vereinbart (§14 IV TzBfG)?", risky: "no", weight: 3 },
      { id: "q5", label: "Klare Befristungs-Klausel (Datum/Zweck)?", risky: "no", weight: 2 },
      { id: "q6", label: "Bei Sachgrund 'Vertretung': Verbindung zur vertretenen Person dokumentiert?", risky: "no", weight: 2 },
    ],
    thresholds: { green: 2, amber: 6 },
    recommendations: {
      green: "Befristung tragfähig. Standard-Prozess fortsetzen.",
      amber: "Risikolücken erkennbar. Dokumentation nachschärfen, ggf. Sachgrund nachpflegen.",
      red: "Hohes Entfristungs-Risiko. Bei Klage hohe Wahrscheinlichkeit unbefristetes Arbeitsverhältnis.",
    },
  },
];

export function findRiskCheck(slug: string): RiskCheckDoc | undefined {
  return RISK_CHECKS.find((r) => r.slug === slug);
}

export interface RiskResult {
  score: number;
  maxScore: number;
  level: "green" | "amber" | "red";
  recommendation: string;
}

export function evaluateRisk(check: RiskCheckDoc, answers: Record<string, AnswerValue>): RiskResult {
  let score = 0;
  let max = 0;
  for (const q of check.questions) {
    max += q.weight;
    const a = answers[q.id];
    if (a === q.risky) score += q.weight;
    else if (a === "unknown") score += Math.ceil(q.weight / 2);
  }
  const level: RiskResult["level"] =
    score <= check.thresholds.green ? "green" : score <= check.thresholds.amber ? "amber" : "red";
  return {
    score,
    maxScore: max,
    level,
    recommendation: check.recommendations[level],
  };
}
