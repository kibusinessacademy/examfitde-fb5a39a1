/**
 * findingValidator
 * ────────────────
 * Field-level Plausibilitätschecks oberhalb der Zod-Validierung.
 * Liefert pro Finding eine Liste konkreter Korrektur-Hinweise.
 */
import type { RawFindingInput } from "./findingSchema";

export type IssueSeverity = "error" | "warn" | "info";

export interface FieldIssue {
  field: string;
  severity: IssueSeverity;
  message: string;
  hint?: string;
}

export interface FindingValidationResult {
  index: number;
  key: string;
  issues: FieldIssue[];
}

const VALID_LEVELS = new Set(["info", "warn", "error"]);
const VALID_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const PACKAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateFinding(
  f: RawFindingInput & { priority?: string; package_id?: string; packageId?: string },
  index: number,
): FindingValidationResult {
  const issues: FieldIssue[] = [];
  const key = `${f.scanner_name ?? "?"}::${f.internal_id ?? f.id ?? `idx_${index}`}`;

  // Pflichtfelder
  if (!f.scanner_name || !f.scanner_name.trim()) {
    issues.push({
      field: "scanner_name",
      severity: "error",
      message: "scanner_name fehlt.",
      hint: 'z. B. "supabase_lov", "agent_security", "github_actions_audit".',
    });
  }
  if (!f.id && !f.internal_id) {
    issues.push({
      field: "id|internal_id",
      severity: "error",
      message: "Mindestens eine ID muss gesetzt sein.",
      hint: "Empfehlung: id = Scanner-Kategorie, internal_id = eindeutiger Slug pro Vorkommen.",
    });
  }
  if (!f.name && !f.description) {
    issues.push({
      field: "name|description",
      severity: "warn",
      message: "Weder name noch description gesetzt — Klassifizierung wird ungenau.",
      hint: "Mindestens 1 Satz beschreiben, damit die Heuristik greift.",
    });
  }

  // Level
  if (f.level && !VALID_LEVELS.has(String(f.level))) {
    issues.push({
      field: "level",
      severity: "warn",
      message: `Ungültiges level "${f.level}".`,
      hint: 'Erlaubt: "info" | "warn" | "error". Sonst wird default "warn" angenommen.',
    });
  }

  // Priority — falls explizit mitgeliefert
  const prio = (f as { priority?: string }).priority;
  if (prio !== undefined && !VALID_PRIORITIES.has(prio)) {
    issues.push({
      field: "priority",
      severity: "error",
      message: `Ungültige Priority "${prio}".`,
      hint: "Erlaubt: P0, P1, P2, P3. Wenn unsicher: Feld weglassen — Heuristik berechnet sie.",
    });
  }

  // Package-IDs (falls vorhanden)
  const pkg = (f as { package_id?: string; packageId?: string }).package_id
    ?? (f as { packageId?: string }).packageId;
  if (pkg !== undefined && pkg !== null && pkg !== "" && !PACKAGE_ID_RE.test(String(pkg))) {
    issues.push({
      field: "package_id",
      severity: "error",
      message: `package_id "${pkg}" ist keine gültige UUID.`,
      hint: "Erwartet: UUID v4 (8-4-4-4-12 hex).",
    });
  }

  // ignore-Konsistenz
  if (f.ignore && !f.ignore_reason) {
    issues.push({
      field: "ignore_reason",
      severity: "warn",
      message: "ignore=true ohne ignore_reason.",
      hint: "Begründung pflegen, sonst wird die Ausnahme später nicht nachvollziehbar.",
    });
  }

  // Description-Heuristik
  if (f.description && f.description.length > 2000) {
    issues.push({
      field: "description",
      severity: "info",
      message: "description sehr lang (>2000 Zeichen).",
      hint: "Lange Inhalte besser ins Feld details verschieben.",
    });
  }

  // Link
  if (f.link && !/^https?:\/\//i.test(f.link)) {
    issues.push({
      field: "link",
      severity: "warn",
      message: "link ist keine http(s)-URL.",
      hint: 'Format: "https://docs.lovable.dev/…"',
    });
  }

  return { index, key, issues };
}

export function validateAllFindings(
  findings: RawFindingInput[],
): {
  results: FindingValidationResult[];
  errorCount: number;
  warnCount: number;
  cleanCount: number;
} {
  const results = findings.map((f, i) => validateFinding(f, i));
  let errorCount = 0;
  let warnCount = 0;
  let cleanCount = 0;
  for (const r of results) {
    const hasError = r.issues.some((i) => i.severity === "error");
    const hasWarn = r.issues.some((i) => i.severity === "warn");
    if (hasError) errorCount++;
    else if (hasWarn) warnCount++;
    else cleanCount++;
  }
  return { results, errorCount, warnCount, cleanCount };
}
