/**
 * P-Completion 1 — Weak-Kompetenz Bridge.
 *
 * Bridges SystemConsciousness `RiskState[]` → real Kompetenz-IDs in the
 * KnowledgeGraph, so `recommendForWeaknesses` (SSOT) can run against
 * actual entities instead of hardcoded demo IDs.
 *
 * Strategy (deterministic, no AI, no random):
 *   1. Take every risk with tone `critical` or `watch`.
 *   2. For each Kompetenz in the graph, score match against the risk:
 *        - meta.linked_risk_keys CSV/array contains the RiskKey      → +3
 *        - entity.key === RiskKey                                    → +3
 *        - entity.key starts with RiskKey or vice-versa (token)      → +2
 *        - entity.name (lowercased) contains a RiskKey token         → +1
 *   3. Tones contribute weight: critical=2, watch=1, stable=0.
 *   4. Aggregate Kompetenz score across all risks, take top N
 *      (default 6), deterministic tiebreak by key.
 *
 * Pure function — safe for SSR and tests.
 */

import type { RiskState } from "@/lib/system/SystemConsciousness";
import type { KnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import type { Kompetenz } from "@/lib/semantic/types";

const RISK_TOKENS: Record<string, ReadonlyArray<string>> = {
  transfer_argumentation: ["transfer", "argumentation", "begruendung"],
  schriftliche_stabilitaet: ["schriftlich", "stabilitaet", "klausur"],
  rueckfragen_wahrscheinlich: ["rueckfrage", "fachgespraech", "muendlich"],
  zeitdruck_relevant: ["zeitdruck", "zeit"],
  praxisbezug: ["praxis", "anwendung"],
  muendliche_stabilitaet: ["muendlich", "fachgespraech", "praesentation"],
  lf5_bewertung: ["lf5", "lernfeld 5", "lernfeld-5"],
  antwortstruktur: ["antwort", "struktur", "argumentation"],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function matchScore(k: Kompetenz, riskKey: string): number {
  const tokens = RISK_TOKENS[riskKey] ?? [riskKey];
  const meta = k.meta ?? {};
  const linkedRaw = meta["linked_risk_keys"];
  const linked = typeof linkedRaw === "string"
    ? linkedRaw.split(",").map((x) => x.trim().toLowerCase())
    : [];
  if (linked.includes(riskKey)) return 3;
  const key = k.key.toLowerCase();
  if (key === riskKey) return 3;
  if (key.startsWith(riskKey) || riskKey.startsWith(key)) return 2;
  const name = normalize(k.name);
  for (const t of tokens) {
    if (name.includes(t)) return 1;
  }
  return 0;
}

export interface WeakKompetenzResolveInput {
  graph: KnowledgeGraph;
  risks: ReadonlyArray<RiskState>;
  limit?: number;
}

export function resolveWeakKompetenzIds(input: WeakKompetenzResolveInput): ReadonlyArray<string> {
  const limit = Math.max(1, Math.min(20, input.limit ?? 6));
  const activeRisks = input.risks.filter((r) => r.tone === "critical" || r.tone === "watch");
  if (activeRisks.length === 0) return [];

  const kompetenzen = input.graph.entitiesOfKind("kompetenz") as ReadonlyArray<Kompetenz>;
  if (kompetenzen.length === 0) return [];

  const scores = new Map<string, { id: string; key: string; score: number }>();
  for (const r of activeRisks) {
    const toneWeight = r.tone === "critical" ? 2 : 1;
    for (const k of kompetenzen) {
      const m = matchScore(k, r.key);
      if (m === 0) continue;
      const prev = scores.get(k.id);
      const delta = m * toneWeight;
      if (prev) prev.score += delta;
      else scores.set(k.id, { id: k.id, key: k.key, score: delta });
    }
  }

  const sorted = Array.from(scores.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.key < b.key ? -1 : 1;
  });

  return sorted.slice(0, limit).map((x) => x.id);
}

export const __internals = { matchScore, RISK_TOKENS };
