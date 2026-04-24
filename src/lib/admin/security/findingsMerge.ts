/**
 * findingsMerge
 * ─────────────
 * Merge zweier Finding-Listen mit Diff (added/changed/unchanged/ignored).
 * Key-Heuristik: `${scanner_name}::${internal_id ?? id}`.
 */
import type { RawFinding } from "./findingClassifier";

export interface MergeDiff {
  added: RawFinding[];
  changed: Array<{ key: string; before: RawFinding; after: RawFinding; changedFields: string[] }>;
  unchanged: RawFinding[];
  ignored: RawFinding[]; // bestehende, die im neuen Import fehlen
  merged: RawFinding[];
}

const COMPARE_FIELDS: (keyof RawFinding)[] = [
  "name",
  "description",
  "details",
  "level",
  "link",
  "ignore",
  "ignore_reason",
];

function keyOf(f: RawFinding, fallbackIndex = 0): string {
  return `${f.scanner_name ?? "?"}::${f.internal_id ?? f.id ?? `idx_${fallbackIndex}`}`;
}

export function mergeFindings(
  existing: RawFinding[],
  incoming: RawFinding[],
): MergeDiff {
  const existingMap = new Map<string, RawFinding>();
  existing.forEach((f, i) => existingMap.set(keyOf(f, i), f));

  const added: RawFinding[] = [];
  const changed: MergeDiff["changed"] = [];
  const unchanged: RawFinding[] = [];
  const seenKeys = new Set<string>();

  incoming.forEach((f, i) => {
    const k = keyOf(f, i);
    seenKeys.add(k);
    const prev = existingMap.get(k);
    if (!prev) {
      added.push(f);
      return;
    }
    const changedFields: string[] = [];
    for (const field of COMPARE_FIELDS) {
      const a = prev[field];
      const b = f[field];
      if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) {
        changedFields.push(String(field));
      }
    }
    if (changedFields.length > 0) {
      changed.push({ key: k, before: prev, after: { ...prev, ...f }, changedFields });
    } else {
      unchanged.push(prev);
    }
  });

  const ignored: RawFinding[] = [];
  for (const [k, f] of existingMap.entries()) {
    if (!seenKeys.has(k)) ignored.push(f);
  }

  // Merged result: changed nimmt die "after" Variante, unchanged bleibt, added kommt dazu, ignored bleibt erhalten
  const merged: RawFinding[] = [
    ...added,
    ...changed.map((c) => c.after),
    ...unchanged,
    ...ignored,
  ];

  return { added, changed, unchanged, ignored, merged };
}
