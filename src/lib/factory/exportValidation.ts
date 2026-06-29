/**
 * Offline Export Validation (PHK.EXPORT.OFFLINE.VALIDATION.1)
 *
 * Before a learner downloads a re-zipped export package, we must guarantee that
 * the critical surfaces — course modules, assets, visualizations, oral exam
 * payload, manifest — are actually contained in the selection set. If a user
 * (accidentally) unchecked one of these directories in the preview, the
 * download would silently ship an incomplete archive. This module performs
 * that check **purely client-side**, without re-downloading the ZIP.
 */

import type { ManifestFile } from "@/lib/factory/exportManifest";

export type ExportCategory =
  | "course_modules"
  | "assets"
  | "visualizations"
  | "oral_exam"
  | "manifest";

export interface ExportCategoryRule {
  category: ExportCategory;
  label: string;
  /** Path prefixes that count as "this category" (any match → in-category). */
  prefixes: string[];
  /** If true, missing category blocks the download with a hard error. */
  critical: boolean;
}

/**
 * SSOT for what must be present in every learner export.
 * Order is intentional — UIs may render the report in this order.
 */
export const EXPORT_CATEGORY_RULES: ExportCategoryRule[] = [
  {
    category: "manifest",
    label: "Manifest & Metadaten",
    prefixes: ["manifest.json", "README.md", "package.json"],
    critical: true,
  },
  {
    category: "course_modules",
    label: "Kursmodule / Lektionen",
    prefixes: ["course_modules/", "modules/", "lessons/", "lerneinheiten/"],
    critical: true,
  },
  {
    category: "assets",
    label: "Assets (Bilder / PDFs)",
    prefixes: ["assets/", "images/", "media/", "downloads/"],
    critical: true,
  },
  {
    category: "visualizations",
    label: "Visualisierungen",
    prefixes: ["visualizations/", "visuals/", "diagrams/"],
    critical: false,
  },
  {
    category: "oral_exam",
    label: "Mündliche Prüfung (Oral Exam)",
    prefixes: ["oral_exam/", "oral/"],
    critical: false,
  },
];

export interface ExportCategoryReport {
  category: ExportCategory;
  label: string;
  critical: boolean;
  /** Number of files in the manifest that match this category. */
  total: number;
  /** Number of those that are currently in the selection (and not blocked). */
  selected: number;
  /** Number of those that are excluded but should be auto-included. */
  missing: number;
  /** Paths that are blocked at the manifest level — cannot be auto-fixed. */
  blocked: string[];
}

export interface ExportValidationReport {
  ok: boolean;
  blocking: boolean;
  reports: ExportCategoryReport[];
  /** Flat list of selectable file paths that should be re-added. */
  missingPaths: string[];
  /** Critical files that are blocked at manifest level (download is unsafe). */
  blockedCriticalPaths: string[];
  /** Human-readable summary line (German). */
  summary: string;
}

function matchesPrefix(path: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (p.endsWith("/")) {
      if (path.startsWith(p)) return true;
    } else if (path === p || path.endsWith(`/${p}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that the selection covers every critical category present in the
 * manifest. Pure function — no I/O, easy to unit-test under load.
 */
export function validateExportCompleteness(
  files: ManifestFile[],
  selected: Set<string> | ReadonlySet<string>,
  rules: ExportCategoryRule[] = EXPORT_CATEGORY_RULES,
): ExportValidationReport {
  const reports: ExportCategoryReport[] = [];
  const missingPaths = new Set<string>();
  const blockedCriticalPaths: string[] = [];

  for (const rule of rules) {
    let total = 0;
    let selectedCount = 0;
    let missing = 0;
    const blocked: string[] = [];

    for (const f of files) {
      if (!matchesPrefix(f.path, rule.prefixes)) continue;
      total++;
      if (f.kind === "blocked") {
        blocked.push(f.path);
        if (rule.critical) blockedCriticalPaths.push(f.path);
        continue;
      }
      if (selected.has(f.path)) {
        selectedCount++;
      } else {
        missing++;
        missingPaths.add(f.path);
      }
    }

    reports.push({
      category: rule.category,
      label: rule.label,
      critical: rule.critical,
      total,
      selected: selectedCount,
      missing,
      blocked,
    });
  }

  const blocking = reports.some(
    (r) => r.critical && (r.total === 0 || r.selected === 0 || r.blocked.length > 0),
  );
  const ok = !blocking && missingPaths.size === 0;

  let summary: string;
  if (ok) {
    summary = "Alle kritischen Kategorien vollständig im Re-Zip enthalten.";
  } else if (blocking) {
    summary = "Kritische Inhalte fehlen oder sind blockiert — Download gesperrt.";
  } else {
    summary = `${missingPaths.size} Datei(en) werden automatisch ergänzt, um Vollständigkeit zu sichern.`;
  }

  return {
    ok,
    blocking,
    reports,
    missingPaths: [...missingPaths],
    blockedCriticalPaths,
    summary,
  };
}

/**
 * Returns a new selection set with all auto-fixable missing critical paths
 * added back. Never drops existing selections, never re-adds blocked files.
 */
export function autoIncludeCriticalPaths(
  files: ManifestFile[],
  selected: Set<string> | ReadonlySet<string>,
  rules: ExportCategoryRule[] = EXPORT_CATEGORY_RULES,
): Set<string> {
  const next = new Set<string>(selected);
  const report = validateExportCompleteness(files, selected, rules);
  const blockedLookup = new Set(report.blockedCriticalPaths);
  for (const path of report.missingPaths) {
    if (blockedLookup.has(path)) continue;
    next.add(path);
  }
  return next;
}
