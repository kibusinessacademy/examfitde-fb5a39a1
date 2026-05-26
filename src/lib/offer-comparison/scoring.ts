/**
 * Deterministic Scoring Engine.
 *
 * - Normalisierung pro Kriterium über das Angebots-Set (min/max).
 * - Gewichtete Aggregation → overall 0–100.
 * - Subscores aus Kriterien-Gruppen.
 * - Erklärbar: jeder Beitrag mit Reasoning-String.
 * - Labels nach deterministischen Regeln.
 *
 * Pure functions, side-effect-free.
 */
import { CRITERIA, CRITERIA_BY_KEY } from "./criteria";
import type {
  CriterionKey,
  Offer,
  OfferLabel,
  OfferScore,
  Project,
} from "./types";

function range(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, span: max - min };
}

function normalize(value: number, min: number, max: number, direction: "higher_better" | "lower_better") {
  if (max === min) return 1;
  const t = (value - min) / (max - min);
  return direction === "higher_better" ? t : 1 - t;
}

function weightFor(project: Project, key: CriterionKey): number {
  const override = project.weights[key];
  if (typeof override === "number") return override;
  return CRITERIA_BY_KEY[key].defaultWeight;
}

function reasoningFor(
  def: ReturnType<typeof CRITERIA_BY_KEY[CriterionKey] extends infer T ? () => T : never> extends never
    ? typeof CRITERIA_BY_KEY[CriterionKey]
    : never,
  raw: number,
  normalized: number,
): string {
  const pct = Math.round(normalized * 100);
  const direction = def.direction === "lower_better" ? "niedriger = besser" : "höher = besser";
  return `${def.label}: Rohwert ${raw} (${direction}) → ${pct}% relative Stärke im Set.`;
}

export function scoreOffer(project: Project, offer: Offer, allOffers: Offer[]): OfferScore {
  const activeKeys = project.activeCriteria;
  const breakdown: OfferScore["breakdown"] = [];

  let weightSum = 0;
  let weighted = 0;

  // Pre-compute ranges per criterion across the set
  const ranges = new Map<CriterionKey, { min: number; max: number }>();
  for (const key of activeKeys) {
    const vals = allOffers
      .map((o) => o.values.find((v) => v.key === key)?.value)
      .filter((v): v is number => typeof v === "number");
    if (vals.length === 0) continue;
    ranges.set(key, range(vals));
  }

  for (const key of activeKeys) {
    const def = CRITERIA_BY_KEY[key];
    const value = offer.values.find((v) => v.key === key)?.value;
    const r = ranges.get(key);
    if (typeof value !== "number" || !r) continue;
    const normalized = normalize(value, r.min, r.max, def.direction);
    const w = weightFor(project, key);
    weightSum += w;
    weighted += normalized * w;
    breakdown.push({
      key,
      weight: w,
      normalized,
      contribution: normalized * w,
      reasoning: reasoningFor(def, value, normalized),
    });
  }

  const overall = weightSum === 0 ? 0 : Math.round((weighted / weightSum) * 100);

  // Subscores aggregated from groups
  function groupScore(keys: CriterionKey[]): number {
    const rows = breakdown.filter((b) => keys.includes(b.key));
    if (rows.length === 0) return 0;
    const ws = rows.reduce((s, r) => s + r.weight, 0);
    if (ws === 0) return 0;
    const wn = rows.reduce((s, r) => s + r.normalized * r.weight, 0);
    return Math.round((wn / ws) * 100);
  }

  const subscores: OfferScore["subscores"] = {
    preis: groupScore(["preis", "hidden_costs"]),
    risiko: groupScore(["risiko", "datenschutz"]),
    leistung: groupScore(["leistung", "sla"]),
    flexibilitaet: groupScore(["flexibilitaet", "kuendigung", "laufzeit"]),
    compliance: groupScore(["datenschutz", "transparenz"]),
    transparenz: groupScore(["transparenz"]),
    skalierbarkeit: groupScore(["skalierbarkeit", "integrationen"]),
    zukunftssicherheit: groupScore(["skalierbarkeit", "flexibilitaet", "integrationen"]),
  };

  return { overall, subscores, labels: [], breakdown };
}

export interface ScoredOffer {
  offer: Offer;
  score: OfferScore;
}

export function scoreProject(project: Project): ScoredOffer[] {
  const scored = project.offers.map((o) => ({ offer: o, score: scoreOffer(project, o, project.offers) }));
  return assignLabels(scored);
}

function assignLabels(scored: ScoredOffer[]): ScoredOffer[] {
  if (scored.length === 0) return scored;

  const sorted = [...scored].sort((a, b) => b.score.overall - a.score.overall);
  const best = sorted[0];
  const lowestRisk = [...scored].sort((a, b) => b.score.subscores.risiko - a.score.subscores.risiko)[0];
  const bestPrice = [...scored].sort((a, b) => b.score.subscores.preis - a.score.subscores.preis)[0];
  const bestFlex = [...scored].sort((a, b) => b.score.subscores.flexibilitaet - a.score.subscores.flexibilitaet)[0];

  return scored.map((s) => {
    const labels: OfferLabel[] = [];
    if (s.offer.id === best.offer.id) labels.push("best_overall");
    if (s.offer.id === lowestRisk.offer.id) labels.push("lowest_risk");
    if (s.offer.id === bestPrice.offer.id) labels.push("best_price");
    if (s.offer.id === bestFlex.offer.id) labels.push("best_flexibility");
    if (s.score.overall < 55) labels.push("not_recommended");
    // Negotiation candidate: hoher Score, aber hoher Preis-Gap zum besten
    if (
      s.offer.id !== bestPrice.offer.id &&
      s.score.overall >= 70 &&
      s.score.subscores.preis < bestPrice.score.subscores.preis - 15
    ) {
      labels.push("negotiation_candidate");
    }
    return { ...s, score: { ...s.score, labels } };
  });
}

export const LABEL_META: Record<OfferLabel, { label: string; tone: "success" | "warning" | "error" | "info" }> = {
  best_overall: { label: "Best Overall", tone: "success" },
  lowest_risk: { label: "Lowest Risk", tone: "success" },
  best_price: { label: "Best Price", tone: "info" },
  best_flexibility: { label: "Best Flexibility", tone: "info" },
  negotiation_candidate: { label: "Negotiation Candidate", tone: "warning" },
  not_recommended: { label: "Not Recommended", tone: "error" },
};
