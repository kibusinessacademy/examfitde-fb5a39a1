/**
 * findingsImportLog
 * ─────────────────
 * Reiner Client-State (sessionStorage) für reproducible Import/Merge/Undo
 * Test-Runs. Hält ein Append-Log + den AKTIVEN Snapshot. Strikte Reihenfolge:
 * jeder neue Apply ersetzt den Snapshot → Undo restored exakt den letzten Import.
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
 * Build a wizard-friendly grouping: pairs each apply with its preceding import
 * and any subsequent undo/discard, so the UI can render scenarios as rows.
 */
export interface ScenarioRow {
  id: string;
  startedAt: number;
  fileName?: string | null;
  mode?: ImportMode;
  precheckOk?: boolean;
  applied: boolean;
  undone: boolean;
  discarded: boolean;
  diff?: { added: number; changed: number; unchanged: number; ignored: number };
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
      };
    } else if (cur) {
      if (e.step === "precheck") cur.precheckOk = e.precheckOk;
      if (e.step === "apply") {
        cur.applied = true;
        cur.mode = e.mode;
        cur.diff = {
          added: e.addedCount ?? 0,
          changed: e.changedCount ?? 0,
          unchanged: e.unchangedCount ?? 0,
          ignored: e.ignoredCount ?? 0,
        };
      }
      if (e.step === "undo") cur.undone = true;
      if (e.step === "discard") cur.discarded = true;
    }
  }
  if (cur) rows.push(cur);
  return rows.reverse(); // newest first
}
