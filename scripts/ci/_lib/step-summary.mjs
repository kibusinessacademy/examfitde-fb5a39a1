/**
 * Shared CI Step-Summary helper for the Learner-Gate workflows.
 * Renders a single, consistent table across:
 *   - scripts/guards/qa-pins-validation.mjs
 *   - scripts/ci/learner-progress-summary.mjs
 *
 * Columns are stable so dashboards/grep across runs work:
 *   workflow | status | course_id | course_title | lesson_id |
 *   progress_before | progress_after | lesson_status_after | retry_reason | notes
 */
import fs from "node:fs";

export const LEARNER_GATE_HEADER = [
  "Workflow",
  "Status",
  "Course ID",
  "Course Title",
  "Lesson ID",
  "progress_before",
  "progress_after",
  "lesson_status_after",
  "retry_reason",
  "Notes",
];

const fallback = (v) => (v === undefined || v === null || v === "" ? "—" : String(v));

export function renderLearnerGateTable(rows, { title } = {}) {
  const lines = [];
  if (title) lines.push(`## ${title}`, "");
  lines.push(`| ${LEARNER_GATE_HEADER.join(" | ")} |`);
  lines.push(`|${LEARNER_GATE_HEADER.map(() => "---").join("|")}|`);
  for (const r of rows) {
    lines.push(
      "| " +
        [
          r.workflow,
          r.status,
          r.course_id,
          r.course_title,
          r.lesson_id,
          r.progress_before,
          r.progress_after,
          r.lesson_status_after,
          r.retry_reason,
          r.notes,
        ]
          .map(fallback)
          .map((s) => s.replace(/\|/g, "\\|"))
          .join(" | ") +
        " |",
    );
  }
  return lines.join("\n") + "\n";
}

export function appendStepSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  fs.appendFileSync(path, markdown.endsWith("\n") ? markdown : markdown + "\n");
}
