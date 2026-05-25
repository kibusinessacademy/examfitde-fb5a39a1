/**
 * W1 Cut 3b — Weakness Cluster Intelligence (deterministic classifier).
 *
 * Maps a Kompetenz's optional meta tags into a closed taxonomy of
 * exam-relevant clusters. Pure function — no AI, no random, no examiner
 * recomputation.
 *
 * Meta convention (string|number|boolean|null on Kompetenz.meta):
 *   - `cluster_typische_pruefungsfalle`     : truthy → "typische_pruefungsfalle"
 *   - `cluster_oft_verwechselt_mit`         : truthy → "oft_verwechselt_mit"
 *   - `cluster_hohe_durchfall_relevanz`     : truthy → "hohe_durchfall_relevanz"
 *   - `cluster_muendliche_pruefung_kritisch`: truthy → "muendliche_pruefung_kritisch"
 *   - `cluster_zeitdruck_anfaellig`         : truthy → "zeitdruck_anfaellig"
 *   - `difficulty` (1..5)                    : ≥4 → adds "hohe_durchfall_relevanz"
 */

import type { Kompetenz } from "@/lib/semantic/types";

export const WEAKNESS_CLUSTER_TAGS = [
  "typische_pruefungsfalle",
  "oft_verwechselt_mit",
  "hohe_durchfall_relevanz",
  "muendliche_pruefung_kritisch",
  "zeitdruck_anfaellig",
] as const;

export type WeaknessClusterTag = (typeof WEAKNESS_CLUSTER_TAGS)[number];

function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return v.length > 0 && v.toLowerCase() !== "false" && v !== "0";
  return false;
}

export function classifyWeaknessClusters(k: Kompetenz): ReadonlyArray<WeaknessClusterTag> {
  const meta = k.meta ?? {};
  const tags = new Set<WeaknessClusterTag>();
  if (truthy(meta["cluster_typische_pruefungsfalle"])) tags.add("typische_pruefungsfalle");
  if (truthy(meta["cluster_oft_verwechselt_mit"])) tags.add("oft_verwechselt_mit");
  if (truthy(meta["cluster_hohe_durchfall_relevanz"])) tags.add("hohe_durchfall_relevanz");
  if (truthy(meta["cluster_muendliche_pruefung_kritisch"])) tags.add("muendliche_pruefung_kritisch");
  if (truthy(meta["cluster_zeitdruck_anfaellig"])) tags.add("zeitdruck_anfaellig");
  if ((k.difficulty ?? 0) >= 4) tags.add("hohe_durchfall_relevanz");
  // Deterministic ordering.
  return WEAKNESS_CLUSTER_TAGS.filter((t) => tags.has(t));
}

export const WEAKNESS_CLUSTER_LABEL: Readonly<Record<WeaknessClusterTag, string>> = {
  typische_pruefungsfalle: "Typische Prüfungsfalle",
  oft_verwechselt_mit: "Häufig verwechselt",
  hohe_durchfall_relevanz: "Hohe Durchfall-Relevanz",
  muendliche_pruefung_kritisch: "Mündlich kritisch",
  zeitdruck_anfaellig: "Anfällig unter Zeitdruck",
};
