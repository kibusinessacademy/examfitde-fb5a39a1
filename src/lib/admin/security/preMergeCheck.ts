/**
 * preMergeCheck
 * ─────────────
 * Client-seitiger Gate vor dem Findings-Merge. Da der Browser kein npm laufen
 * lassen kann, prüfen wir die EFFEKTE eines Build/Lint-Runs:
 *   1. TypeScript: parseFindingsJson + validateAllFindings müssen 0 Errors liefern
 *   2. Lint-äquivalent: keine forbidden patterns (eval, harte URLs zu localhost,
 *      doppelte Keys via Schema-Warnings)
 *   3. Optional: zuletzt protokollierter externer Build/Lint-Status aus
 *      sessionStorage (z. B. von einem CI-Webhook gefüttert)
 *
 * Liefert ok=true nur, wenn alle Checks bestanden sind. Der UI-Layer blockiert
 * den Merge bei ok=false.
 */
import { parseFindingsJson } from "./findingSchema";
import { validateAllFindings } from "./findingValidator";

export interface PreMergeIssue {
  check: "schema" | "validator" | "lint_pattern" | "external_ci";
  severity: "error" | "warn";
  message: string;
}

export interface PreMergeResult {
  ok: boolean;
  durationMs: number;
  issues: PreMergeIssue[];
  stats: {
    parsed: number;
    schemaErrors: number;
    schemaWarnings: number;
    validatorErrors: number;
    validatorWarnings: number;
    lintPatternHits: number;
  };
  externalCi?: { build: "pass" | "fail" | "unknown"; lint: "pass" | "fail" | "unknown"; updatedAt?: number };
}

const CI_KEY = "secfindings.ci.status.v1";

export interface ExternalCiStatus {
  build: "pass" | "fail" | "unknown";
  lint: "pass" | "fail" | "unknown";
  updatedAt: number;
}

export function readExternalCiStatus(): ExternalCiStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CI_KEY);
    return raw ? (JSON.parse(raw) as ExternalCiStatus) : null;
  } catch {
    return null;
  }
}

export function writeExternalCiStatus(s: ExternalCiStatus) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CI_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; msg: string }> = [
  { re: /\beval\s*\(/, msg: "eval() im Payload — verboten" },
  { re: /https?:\/\/(localhost|127\.0\.0\.1)/i, msg: "localhost-URL im Payload" },
  { re: /["']password["']\s*:/i, msg: "Klartext-Passwort-Feld im Payload" },
];

export function runPreMergeCheck(rawJson: string): PreMergeResult {
  const t0 = performance.now();
  const issues: PreMergeIssue[] = [];

  // 1. Schema
  const parsed = parseFindingsJson(rawJson);
  const schemaErrors = parsed.ok ? 0 : parsed.errors.length;
  const schemaWarnings = parsed.warnings.length;
  if (!parsed.ok) {
    for (const e of parsed.errors.slice(0, 5)) {
      issues.push({ check: "schema", severity: "error", message: e });
    }
  }
  for (const w of parsed.warnings.slice(0, 3)) {
    issues.push({ check: "schema", severity: "warn", message: w });
  }

  // 2. Validator
  let validatorErrors = 0;
  let validatorWarnings = 0;
  if (parsed.ok) {
    const v = validateAllFindings(parsed.findings);
    validatorErrors = v.errorCount;
    validatorWarnings = v.warnCount;
    if (v.errorCount > 0) {
      const firstErr = v.results.find((r) => r.issues.some((i) => i.severity === "error"));
      if (firstErr) {
        const e = firstErr.issues.find((i) => i.severity === "error")!;
        issues.push({
          check: "validator",
          severity: "error",
          message: `#${firstErr.index} ${firstErr.key} → ${e.field}: ${e.message}`,
        });
      }
    }
  }

  // 3. Lint-Pattern
  let lintPatternHits = 0;
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.re.test(rawJson)) {
      lintPatternHits++;
      issues.push({ check: "lint_pattern", severity: "error", message: p.msg });
    }
  }

  // 4. External CI (best-effort)
  const ci = readExternalCiStatus();
  if (ci) {
    if (ci.build === "fail") {
      issues.push({ check: "external_ci", severity: "error", message: "Letzter externer Build: FAIL" });
    }
    if (ci.lint === "fail") {
      issues.push({ check: "external_ci", severity: "error", message: "Letzter externer Lint: FAIL" });
    }
  }

  const ok =
    schemaErrors === 0 && validatorErrors === 0 && lintPatternHits === 0 &&
    (!ci || (ci.build !== "fail" && ci.lint !== "fail"));

  return {
    ok,
    durationMs: Math.round(performance.now() - t0),
    issues,
    stats: {
      parsed: parsed.ok ? parsed.findings.length : 0,
      schemaErrors,
      schemaWarnings,
      validatorErrors,
      validatorWarnings,
      lintPatternHits,
    },
    externalCi: ci ?? undefined,
  };
}
