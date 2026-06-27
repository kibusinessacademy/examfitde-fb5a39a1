/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Deterministic blocker clustering.
 * Groups identical blocker-code sets that co-occur on the same manifest+action.
 */
import type { AutopilotActionSnapshot, BatchItemSnapshot, BlockerCluster } from "./contracts.ts";

interface Row {
  manifest_id: string;
  action_type: string;
  blocker_codes: string[];
}

export function clusterBlockers(
  items: BatchItemSnapshot[],
  actions: AutopilotActionSnapshot[],
): BlockerCluster[] {
  const rows: Row[] = [
    ...items.map((i) => ({ manifest_id: i.manifest_id, action_type: i.action_type, blocker_codes: i.blocker_codes })),
    ...actions.map((a) => ({ manifest_id: a.manifest_id, action_type: a.action_type, blocker_codes: a.blocker_codes })),
  ].filter((r) => r.blocker_codes.length > 0);

  const map = new Map<string, { codes: string[]; occurrences: number; manifests: Set<string>; actions: Set<string> }>();
  for (const r of rows) {
    const codes = [...r.blocker_codes].sort();
    const key = codes.join("|");
    const cur = map.get(key) ?? { codes, occurrences: 0, manifests: new Set<string>(), actions: new Set<string>() };
    cur.occurrences++;
    cur.manifests.add(r.manifest_id);
    cur.actions.add(r.action_type);
    map.set(key, cur);
  }

  return [...map.entries()]
    .map(([cluster_key, v]) => ({
      cluster_key,
      blocker_codes: v.codes,
      occurrences: v.occurrences,
      affected_manifest_count: v.manifests.size,
      affected_action_types: [...v.actions].sort(),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || (a.cluster_key < b.cluster_key ? -1 : 1));
}
