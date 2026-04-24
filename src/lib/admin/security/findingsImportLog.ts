/**
 * findingsImportLog
 * ─────────────────
 * Reiner Client-State (sessionStorage) für reproducible Import/Merge/Undo
 * Test-Runs. Jeder Apply ersetzt den Snapshot → Undo restored exakt den letzten Import.
 *
 * Szenarien:
 *  1. Import → (Precheck) → Merge → Undo
 *  2. Import → (Precheck) → Replace → Undo (Replace optional precheck-bypassed)
 *  3. Import → Discard ✕ (kein Apply)
 */
export type ImportMode = "merge" | "replace";
export type ImportStep = "import" | "apply" | "undo" | "discard" | "precheck";

export interface ImportLogEntry {
  id: string;
  step: ImportStep;
  mode?: ImportMode;
  fileName?: string | null;
  addedCount?: number;
  changedCount?: number;
  unchangedCount?: number;
  ignoredCount?: number;
  precheckOk?: boolean;
  note?: string;
  ts: number;
}

const STORAGE_KEY = "secfindings.import.log.v1";
const MAX_ENTRIES = 100;

function read(): ImportLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ImportLogEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: ImportLogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

export function appendImportLog(entry: Omit<ImportLogEntry, "id" | "ts"> & { ts?: number }): ImportLogEntry {
  const full: ImportLogEntry = {
    ...entry,
    id: (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    ts: entry.ts ?? Date.now(),
  };
  const next = [...read(), full];
  write(next);
  return full;
}

export function getImportLog(): ImportLogEntry[] {
  return read();
}

export function clearImportLog() {
  write([]);
}

/**
 * Build a wizard-friendly grouping. Each "import" starts a new scenario row.
 * Subsequent precheck/apply/undo/discard events attach to the current row.
 * `precheckBypassed` is true when an apply event carries note="precheck_bypassed"
 * (Replace ohne grünen Gate).
 */
export interface ScenarioRow {
  id: string;
  startedAt: number;
  endedAt?: number;
  fileName?: string | null;
  mode?: ImportMode;
  precheckOk?: boolean;
  precheckBypassed: boolean;
  applied: boolean;
  undone: boolean;
  discarded: boolean;
  diff?: { added: number; changed: number; unchanged: number; ignored: number };
  importNote?: string;
}

export function buildScenarios(entries: ImportLogEntry[] = read()): ScenarioRow[] {
  const rows: ScenarioRow[] = [];
  let cur: ScenarioRow | null = null;
  for (const e of entries) {
    if (e.step === "import") {
      if (cur) rows.push(cur);
      cur = {
        id: e.id,
        startedAt: e.ts,
        fileName: e.fileName ?? null,
        applied: false,
        undone: false,
        discarded: false,
        precheckBypassed: false,
        importNote: e.note,
      };
    } else if (cur) {
      if (e.step === "precheck") cur.precheckOk = e.precheckOk;
      if (e.step === "apply") {
        cur.applied = true;
        cur.mode = e.mode;
        cur.endedAt = e.ts;
        if (e.note === "precheck_bypassed") cur.precheckBypassed = true;
        if (typeof e.precheckOk === "boolean" && cur.precheckOk === undefined) {
          cur.precheckOk = e.precheckOk;
        }
        cur.diff = {
          added: e.addedCount ?? 0,
          changed: e.changedCount ?? 0,
          unchanged: e.unchangedCount ?? 0,
          ignored: e.ignoredCount ?? 0,
        };
      }
      if (e.step === "undo") {
        cur.undone = true;
        cur.endedAt = e.ts;
      }
      if (e.step === "discard") {
        cur.discarded = true;
        cur.endedAt = e.ts;
      }
    }
  }
  if (cur) rows.push(cur);
  return rows.reverse(); // newest first
}
