/**
 * Sample Cohorts — Demo-SSOT (Cut 2 Market Activation).
 *
 * Realistische, deterministische Fixtures. KEINE DB. KEINE AI-Calls.
 * Zweck: Innerhalb 60–120s sichtbar machen, was BerufsKI/ExamFit kann.
 */

export type RiskBand = "red" | "amber" | "green";

export interface CohortLearnerRisk {
  initials: string;
  riskScore: number; // 0–100
  band: RiskBand;
  driver: string;
  recommendedIntervention: string;
}

export interface CohortKPI {
  label: string;
  value: string;
  delta?: string;
  tone: "positive" | "negative" | "neutral";
}

export interface CohortCompetencyHotspot {
  competency: string;
  masteryPct: number;
  recoveryLiftPct: number;
  note: string;
}

export interface CohortInterventionLog {
  date: string;
  type: "recovery_set" | "tutor_session" | "mentor_call" | "workflow_run";
  outcome: string;
  effectPct: number;
}

export interface SampleCohort {
  slug: string;
  name: string;
  curriculum: string;
  examWindow: string;
  size: number;
  persona: "azubi" | "umschulung" | "weiterbildung";
  headlineRisk: string;
  narrative: string;
  kpis: CohortKPI[];
  riskDistribution: { red: number; amber: number; green: number };
  topRiskLearners: CohortLearnerRisk[];
  competencyHotspots: CohortCompetencyHotspot[];
  recentInterventions: CohortInterventionLog[];
  outcomeForecast: {
    examPassProbability: number;
    confidence: "low" | "medium" | "high";
    drivers: string[];
  };
}

export const SAMPLE_COHORTS: SampleCohort[] = [
  {
    slug: "fisi-fruehjahr-2026",
    name: "FISI Frühjahr 2026",
    curriculum: "Fachinformatiker:in Systemintegration",
    examWindow: "AP2 · Frühjahr 2026",
    size: 28,
    persona: "azubi",
    headlineRisk: "Netzwerktechnik — Recovery-Wirkung sinkt 14% MoM",
    narrative:
      "Die Kohorte zeigt stabile Fortschritte in Programmierung, aber sinkende Recovery-Wirkung im Bereich Netzwerktechnik (LF 7/8). 6 Lernende sind im roten Risiko-Band, davon 4 mit identischem Driver: fehlende Vertiefung Routing-Protokolle.",
    kpis: [
      { label: "Prüfungswahrscheinlichkeit", value: "74%", delta: "−3 pp", tone: "negative" },
      { label: "Recovery-Lift Ø", value: "+18%", delta: "−4 pp", tone: "negative" },
      { label: "Tutor-Sessions/Woche", value: "42", delta: "+12", tone: "positive" },
      { label: "Bearbeitete Lernfelder", value: "9/11", tone: "neutral" },
    ],
    riskDistribution: { red: 6, amber: 11, green: 11 },
    topRiskLearners: [
      { initials: "M.K.", riskScore: 82, band: "red", driver: "Routing-Protokolle nicht gemeistert", recommendedIntervention: "Recovery-Set LF7 + Tutor-Session" },
      { initials: "S.L.", riskScore: 78, band: "red", driver: "Niedrige Aktivität letzte 14 Tage", recommendedIntervention: "Mentor-Call + Lernpfad-Reset" },
      { initials: "T.B.", riskScore: 71, band: "red", driver: "Schwache Performance IT-Sicherheit", recommendedIntervention: "Recovery-Set LF9" },
      { initials: "A.H.", riskScore: 68, band: "amber", driver: "Inkonsistente Tutor-Nutzung", recommendedIntervention: "Workflow Lernroutine" },
    ],
    competencyHotspots: [
      { competency: "LF7 Netzwerke", masteryPct: 54, recoveryLiftPct: 12, note: "Recovery-Wirkung halbiert seit März" },
      { competency: "LF9 IT-Sicherheit", masteryPct: 61, recoveryLiftPct: 22, note: "Stabil, Tutor-Pfad funktioniert" },
      { competency: "LF6 Programmierung", masteryPct: 79, recoveryLiftPct: 28, note: "Über Benchmark" },
    ],
    recentInterventions: [
      { date: "2026-05-22", type: "recovery_set", outcome: "LF7 — 6 Lernende", effectPct: 14 },
      { date: "2026-05-19", type: "tutor_session", outcome: "Routing-Vertiefung", effectPct: 9 },
      { date: "2026-05-15", type: "mentor_call", outcome: "Lernpfad-Reset S.L.", effectPct: 22 },
    ],
    outcomeForecast: {
      examPassProbability: 74,
      confidence: "medium",
      drivers: ["Netzwerktechnik-Schwäche", "stabile Programmierleistung", "hohe Tutor-Adoption"],
    },
  },
  {
    slug: "industriekaufleute-ap2",
    name: "Industriekaufleute AP2",
    curriculum: "Industriekaufmann/-frau",
    examWindow: "AP2 · Sommer 2026",
    size: 34,
    persona: "azubi",
    headlineRisk: "Geschäftsprozesse stabil — Schwäche im Rechnungswesen",
    narrative:
      "Die Kohorte performt überdurchschnittlich in Geschäftsprozessen, hat aber strukturelle Lücken im Rechnungswesen (Kostenrechnung). Recovery-Sets greifen, jedoch nur bei aktiver Tutor-Nutzung.",
    kpis: [
      { label: "Prüfungswahrscheinlichkeit", value: "81%", delta: "+2 pp", tone: "positive" },
      { label: "Recovery-Lift Ø", value: "+24%", tone: "positive" },
      { label: "Tutor-Sessions/Woche", value: "58", delta: "+6", tone: "positive" },
      { label: "Bearbeitete Module", value: "11/13", tone: "neutral" },
    ],
    riskDistribution: { red: 4, amber: 9, green: 21 },
    topRiskLearners: [
      { initials: "J.W.", riskScore: 79, band: "red", driver: "Kostenrechnung — wiederholt fehlerhaft", recommendedIntervention: "Recovery-Set Kostenrechnung + Tutor" },
      { initials: "P.M.", riskScore: 73, band: "red", driver: "Niedrige Lernzeit", recommendedIntervention: "Mentor-Call" },
      { initials: "L.S.", riskScore: 66, band: "amber", driver: "Schwache Performance Marketing-Mix", recommendedIntervention: "Recovery-Set Marketing" },
    ],
    competencyHotspots: [
      { competency: "Kostenrechnung", masteryPct: 58, recoveryLiftPct: 19, note: "Hauptrisiko" },
      { competency: "Geschäftsprozesse", masteryPct: 83, recoveryLiftPct: 31, note: "Top-Performer" },
      { competency: "Marketing", masteryPct: 70, recoveryLiftPct: 24, note: "Stabil" },
    ],
    recentInterventions: [
      { date: "2026-05-23", type: "recovery_set", outcome: "Kostenrechnung — 4 Lernende", effectPct: 18 },
      { date: "2026-05-20", type: "workflow_run", outcome: "Prüfungssimulation AP2", effectPct: 11 },
    ],
    outcomeForecast: {
      examPassProbability: 81,
      confidence: "high",
      drivers: ["starke Geschäftsprozesse", "Tutor-Adoption hoch", "isoliertes Rechnungswesen-Risiko"],
    },
  },
  {
    slug: "aevo-gruppe-q2",
    name: "AEVO-Gruppe Q2",
    curriculum: "AEVO — Ausbildereignung",
    examWindow: "AEVO-Prüfung · Juli 2026",
    size: 18,
    persona: "weiterbildung",
    headlineRisk: "Schriftliche Prüfung stabil — Präsentation als Risikofaktor",
    narrative:
      "Kompakte Gruppe mit hoher Motivation. Theorieteil über Benchmark. Die mündliche Präsentation bleibt das dominante Risiko — 7 Teilnehmer haben noch keine vollständige Konzeption hochgeladen.",
    kpis: [
      { label: "Prüfungswahrscheinlichkeit", value: "88%", delta: "+5 pp", tone: "positive" },
      { label: "Konzepte abgegeben", value: "11/18", delta: "−2", tone: "negative" },
      { label: "Workflow-Runs", value: "47", delta: "+18", tone: "positive" },
      { label: "Tutor-Sessions/Woche", value: "31", tone: "neutral" },
    ],
    riskDistribution: { red: 2, amber: 5, green: 11 },
    topRiskLearners: [
      { initials: "R.O.", riskScore: 74, band: "red", driver: "Konzept fehlt + niedrige Aktivität", recommendedIntervention: "Mentor-Call + Workflow Konzeption" },
      { initials: "K.D.", riskScore: 69, band: "amber", driver: "Konzept nur angefangen", recommendedIntervention: "Workflow Präsentations-Skript" },
    ],
    competencyHotspots: [
      { competency: "HF1 Voraussetzungen prüfen", masteryPct: 86, recoveryLiftPct: 18, note: "Top" },
      { competency: "HF4 Ausbildung durchführen", masteryPct: 79, recoveryLiftPct: 22, note: "Solide" },
      { competency: "Präsentation Praxisteil", masteryPct: 52, recoveryLiftPct: 27, note: "Hauptrisiko" },
    ],
    recentInterventions: [
      { date: "2026-05-21", type: "workflow_run", outcome: "Konzeptions-Workflow", effectPct: 19 },
      { date: "2026-05-18", type: "tutor_session", outcome: "Methodik-Klärung", effectPct: 12 },
    ],
    outcomeForecast: {
      examPassProbability: 88,
      confidence: "high",
      drivers: ["starker Theorieteil", "isoliertes Konzept-Risiko bei 7 TN"],
    },
  },
  {
    slug: "bilanzbuchhalter-intensiv",
    name: "Bilanzbuchhalter Intensiv",
    curriculum: "Geprüfte:r Bilanzbuchhalter:in",
    examWindow: "IHK-Prüfung · Herbst 2026",
    size: 22,
    persona: "weiterbildung",
    headlineRisk: "Steuerrecht & Konzernrechnungslegung — strukturelle Lücken",
    narrative:
      "Anspruchsvolle Kohorte. Externes Rechnungswesen läuft, aber Steuerrecht und Konzernrechnungslegung sind systemische Schwachstellen. 5 Teilnehmer im roten Band — Intervention dringend.",
    kpis: [
      { label: "Prüfungswahrscheinlichkeit", value: "67%", delta: "−5 pp", tone: "negative" },
      { label: "Recovery-Lift Ø", value: "+15%", delta: "−3 pp", tone: "negative" },
      { label: "Tutor-Sessions/Woche", value: "39", delta: "+4", tone: "positive" },
      { label: "Aktive Lernende", value: "20/22", tone: "neutral" },
    ],
    riskDistribution: { red: 5, amber: 8, green: 9 },
    topRiskLearners: [
      { initials: "C.R.", riskScore: 84, band: "red", driver: "Steuerrecht — wiederholte Fehlmuster", recommendedIntervention: "Recovery-Set Steuerrecht + Mentor" },
      { initials: "B.N.", riskScore: 80, band: "red", driver: "Konzernrechnungslegung ungemeistert", recommendedIntervention: "Workflow Konsolidierung + Tutor" },
      { initials: "G.S.", riskScore: 76, band: "red", driver: "Niedrige Aktivität + breite Lücken", recommendedIntervention: "Mentor-Call + Lernpfad-Reset" },
    ],
    competencyHotspots: [
      { competency: "Steuerrecht", masteryPct: 51, recoveryLiftPct: 14, note: "Hauptrisiko Recovery schwach" },
      { competency: "Konzernrechnungslegung", masteryPct: 56, recoveryLiftPct: 17, note: "Strukturelle Lücke" },
      { competency: "Externes Rechnungswesen", masteryPct: 78, recoveryLiftPct: 26, note: "Solide Basis" },
    ],
    recentInterventions: [
      { date: "2026-05-24", type: "recovery_set", outcome: "Steuerrecht — 5 TN", effectPct: 11 },
      { date: "2026-05-22", type: "workflow_run", outcome: "Konsolidierungs-Workflow", effectPct: 16 },
      { date: "2026-05-17", type: "mentor_call", outcome: "Lernpfad-Reset G.S.", effectPct: 24 },
    ],
    outcomeForecast: {
      examPassProbability: 67,
      confidence: "medium",
      drivers: ["Steuerrecht-Lücke", "Konzernrechnungslegung", "Recovery-Wirkung sinkend"],
    },
  },
];

export function getCohort(slug: string): SampleCohort | undefined {
  return SAMPLE_COHORTS.find((c) => c.slug === slug);
}
