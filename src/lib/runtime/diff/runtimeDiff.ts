/**
 * Runtime Diff Engine — deterministic before/after comparison for Runtime Actions.
 *
 * Invariants (RUNTIME_DIFF_NO_RANDOMNESS):
 *  - Pure function. No Date.now(), no Math.random(), no Set iteration order leaks.
 *  - Stable sort by path. Same input → byte-identical output.
 *  - Audit-safe: never expands raw payloads; only emits typed deltas.
 *  - UI-safe: serializable JSON only.
 */

export type RuntimeDiffKind =
  | "status_change"
  | "queue_change"
  | "job_count_change"
  | "flag_change"
  | "retry_change"
  | "escalation_change"
  | "priority_change"
  | "dag_unlock"
  | "publish_state_change"
  | "value_change";

export interface RuntimeDiffEntry {
  path: string;
  kind: RuntimeDiffKind;
  before: unknown;
  after: unknown;
  critical: boolean;
}

export interface RuntimeDiffResult {
  entries: RuntimeDiffEntry[];
  added: string[];
  removed: string[];
  changed: string[];
  critical: boolean;
}

const SECRET_KEYS = new Set([
  "password", "secret", "token", "api_key", "apikey",
  "authorization", "stripe_secret", "service_role_key",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function redact(key: string, value: unknown): unknown {
  if (SECRET_KEYS.has(key.toLowerCase())) return "[REDACTED]";
  return value;
}

function classify(path: string, before: unknown, after: unknown): { kind: RuntimeDiffKind; critical: boolean } {
  const p = path.toLowerCase();
  if (p.endsWith("status") || p.includes(".status")) {
    const crit = String(after).toLowerCase() === "published" || String(before).toLowerCase() === "published";
    return { kind: p.includes("publish") ? "publish_state_change" : "status_change", critical: crit };
  }
  if (p.includes("queue")) return { kind: "queue_change", critical: false };
  if (p.includes("job_count") || p.endsWith("jobs")) return { kind: "job_count_change", critical: false };
  if (p.includes("priority")) return { kind: "priority_change", critical: false };
  if (p.includes("retry")) return { kind: "retry_change", critical: false };
  if (p.includes("escalation") || p.includes("escalat")) return { kind: "escalation_change", critical: true };
  if (p.includes("dag") && (after === "unlocked" || after === true)) return { kind: "dag_unlock", critical: true };
  if (p.includes("flag") || p.includes("feature_flag") || typeof before === "boolean" || typeof after === "boolean") {
    return { kind: "flag_change", critical: false };
  }
  return { kind: "value_change", critical: false };
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  out: { entries: RuntimeDiffEntry[]; added: string[]; removed: string[]; changed: string[] },
): void {
  if (before === undefined && after !== undefined) {
    out.added.push(path);
    const cls = classify(path, before, after);
    out.entries.push({ path, kind: cls.kind, before: null, after: redact(path.split(".").pop() ?? "", after), critical: cls.critical });
    return;
  }
  if (before !== undefined && after === undefined) {
    out.removed.push(path);
    const cls = classify(path, before, after);
    out.entries.push({ path, kind: cls.kind, before: redact(path.split(".").pop() ?? "", before), after: null, critical: cls.critical });
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    for (const k of keys) walk(before[k], after[k], path ? `${path}.${k}` : k, out);
    return;
  }
  // primitives / arrays — shallow compare via JSON for arrays
  const a = JSON.stringify(before ?? null);
  const b = JSON.stringify(after ?? null);
  if (a !== b) {
    out.changed.push(path);
    const cls = classify(path, before, after);
    out.entries.push({
      path,
      kind: cls.kind,
      before: redact(path.split(".").pop() ?? "", before),
      after: redact(path.split(".").pop() ?? "", after),
      critical: cls.critical,
    });
  }
}

export function buildRuntimeDiff(before: unknown, after: unknown): RuntimeDiffResult {
  const out = { entries: [] as RuntimeDiffEntry[], added: [] as string[], removed: [] as string[], changed: [] as string[] };
  walk(before ?? {}, after ?? {}, "", out);
  out.entries.sort((x, y) => x.path.localeCompare(y.path));
  out.added.sort();
  out.removed.sort();
  out.changed.sort();
  return { ...out, critical: out.entries.some((e) => e.critical) };
}

export function summarizeRuntimeDiff(diff: RuntimeDiffResult): string {
  if (diff.entries.length === 0) return "No changes";
  const parts: string[] = [];
  if (diff.added.length) parts.push(`+${diff.added.length} added`);
  if (diff.removed.length) parts.push(`-${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`~${diff.changed.length} changed`);
  if (diff.critical) parts.push("⚠ critical mutation");
  return parts.join(" · ");
}

export function detectCriticalMutation(diff: RuntimeDiffResult): boolean {
  return diff.critical;
}
