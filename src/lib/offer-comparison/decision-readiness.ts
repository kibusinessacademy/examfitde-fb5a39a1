/**
 * Decision Readiness Engine (0–100) + Executive Summary Generator.
 *
 * Beide deterministisch. Executive Summary nutzt Top-Scores + Risiken
 * für eine boardroom-fertige Zusammenfassung — kein LLM-Call.
 */
import type { DecisionReadiness, ExecutiveSummary, Project, RiskFinding } from "./types";
import { LEVEL_RANK } from "./risk-engine";
import { scoreProject } from "./scoring";

export function calcReadiness(project: Project, risks: RiskFinding[]): DecisionReadiness {
  const factors = [
    { key: "documents", label: "Dokumente analysiert", done: project.offers.every((o) => o.analysisStatus === "extracted"), weight: 15 },
    { key: "criteria", label: "Kriterien gewichtet", done: project.activeCriteria.length >= 5, weight: 10 },
    { key: "offers", label: "Mindestens 2 Anbieter verglichen", done: project.offers.length >= 2, weight: 15 },
    { key: "risks_reviewed", label: "Risiken sondiert", done: risks.length > 0, weight: 15 },
    { key: "critical_risks", label: "Keine offenen kritischen Risiken", done: !risks.some((r) => r.level === "critical"), weight: 15 },
    { key: "negotiation", label: "Verhandlung durchgeführt", done: project.decisionLog.some((d) => d.type === "negotiation_dispatched"), weight: 15 },
    { key: "approval", label: "Entscheidungs-Freigabe vorhanden", done: project.decisionLog.some((d) => d.type === "approval"), weight: 15 },
  ];
  const totalW = factors.reduce((s, f) => s + f.weight, 0);
  const got = factors.filter((f) => f.done).reduce((s, f) => s + f.weight, 0);
  return { score: Math.round((got / totalW) * 100), factors };
}

export function buildExecutiveSummary(project: Project, risks: RiskFinding[]): ExecutiveSummary {
  const scored = scoreProject(project);
  if (scored.length === 0) {
    return {
      headline: "Noch keine Angebote analysiert.",
      body: ["Laden Sie Angebote hoch, um die AI-Analyse zu starten."],
      recommendation: null,
      watchouts: [],
    };
  }

  const sortedByOverall = [...scored].sort((a, b) => b.score.overall - a.score.overall);
  const best = sortedByOverall[0];
  const cheapest = [...scored].sort((a, b) => a.offer.totalCostEur - b.offer.totalCostEur)[0];
  const safest = [...scored].sort((a, b) => b.score.subscores.risiko - a.score.subscores.risiko)[0];

  const criticals = risks.filter((r) => r.level === "critical").length;
  const highs = risks.filter((r) => r.level === "high").length;

  const watchouts: string[] = [];
  if (criticals > 0) watchouts.push(`${criticals} kritische Risiken erfordern Klärung vor Vertragsunterzeichnung.`);
  if (highs > 0) watchouts.push(`${highs} hohe Risiken sollten in der Verhandlung adressiert werden.`);
  if (best.offer.totalCostEur > project.budgetEur)
    watchouts.push(
      `Top-Empfehlung überschreitet Budget um ${fmt(best.offer.totalCostEur - project.budgetEur)} — Preisverhandlung notwendig.`,
    );

  const body = [
    `${project.offers.length} Anbieter analysiert. ${best.offer.vendor} erreicht den höchsten Gesamt-Score (${best.score.overall}/100) bei einem Gesamt-TCO von ${fmt(best.offer.totalCostEur)}.`,
    `Preisoptimum: ${cheapest.offer.vendor} (${fmt(cheapest.offer.totalCostEur)}). Risikoärmstes Angebot: ${safest.offer.vendor} (Risiko-Subscore ${safest.score.subscores.risiko}/100).`,
    `Decision-Readiness liegt aktuell bei ${calcReadiness(project, risks).score}%.`,
  ];

  return {
    headline: `Empfehlung: ${best.offer.vendor} — ${best.score.overall}/100`,
    body,
    recommendation: {
      offerId: best.offer.id,
      label: `${best.offer.vendor} · ${best.offer.productName}`,
      rationale: best.score.labels.length > 0
        ? `Stärken: ${best.score.labels.join(", ")}.`
        : `Höchster gewichteter Score über die ${project.activeCriteria.length} aktiven Kriterien.`,
    },
    watchouts,
  };
}

function fmt(n: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

export { LEVEL_RANK };
