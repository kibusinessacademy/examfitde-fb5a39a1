/**
 * SSOT: Structured Validation Issue Types
 *
 * Replaces fragile string-based issues (e.g. "HTML_TOO_SHORT: 123/400")
 * with typed objects for robust aggregation, catastrophic detection,
 * and repair routing.
 */

export type IssueSeverity = "info" | "warning" | "error" | "critical";

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  detail?: string;
  metric?: number;
  threshold?: number;
}

export interface T1Result {
  lessonId: string;
  title: string;
  step: string;
  passed: boolean;
  issues: ValidationIssue[];
}

/**
 * Aggregate failure modes from structured issues.
 * No more string splitting — directly uses issue.code.
 */
export function aggregateFailureModes(
  t1Failed: T1Result[],
): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of t1Failed) {
    for (const issue of f.issues) {
      counts.set(issue.code, (counts.get(issue.code) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Detect catastrophic failure state from structured issues.
 * Uses severity + code instead of fragile string matching.
 */
export function detectCatastrophicFailures(
  t1Failed: T1Result[],
  totalLessons: number,
): number {
  // Critical: placeholder/contamination on >30% of all lessons
  const criticalFails = t1Failed.filter((f) =>
    f.issues.some(
      (i) =>
        i.severity === "critical" ||
        i.code === "PLACEHOLDER_STILL_PRESENT" ||
        i.code === "PLACEHOLDER_TEXT_FOUND" ||
        i.code === "CONTAMINATION",
    ),
  );

  // Massive structural absence: >50% with nearly empty content
  const emptyContentFails = t1Failed.filter((f) =>
    f.issues.some(
      (i) =>
        i.code === "HTML_TOO_SHORT" &&
        i.metric !== undefined &&
        i.threshold !== undefined &&
        i.metric < i.threshold * 0.3, // less than 30% of minimum
    ),
  );

  if (
    criticalFails.length > totalLessons * 0.3 ||
    emptyContentFails.length > totalLessons * 0.5
  ) {
    return criticalFails.length + emptyContentFails.length;
  }

  return 0;
}
