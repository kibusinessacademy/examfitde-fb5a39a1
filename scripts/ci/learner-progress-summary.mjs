#!/usr/bin/env node
/**
 * Learner-Progress-Persistence — CI Artifact Summary
 * ---------------------------------------------------
 * Reads Playwright's JSON report and emits two things to GITHUB_STEP_SUMMARY:
 *   1) A unified Learner-Gate table (same columns as qa-pins-validation):
 *        workflow | status | course_id | course_title | lesson_id |
 *        progress_before | progress_after | lesson_status_after | retry_reason | notes
 *   2) Per-test detail block with errors + screenshot filenames.
 *
 * Usage:
 *   node scripts/ci/learner-progress-summary.mjs path/to/results.json
 */
import fs from "node:fs";
import path from "node:path";
import { renderLearnerGateTable, appendStepSummary } from "./_lib/step-summary.mjs";

const reportPath = process.argv[2] || "playwright-report/results.json";

if (!fs.existsSync(reportPath)) {
  console.warn(`No JSON report at ${reportPath} — skipping summary.`);
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));

function walk(suite, acc = []) {
  for (const s of suite.suites || []) walk(s, acc);
  for (const sp of suite.specs || []) {
    for (const t of sp.tests || []) {
      for (const r of t.results || []) {
        acc.push({ title: sp.title, file: sp.file, result: r });
      }
    }
  }
  return acc;
}

const tests = walk(data);
const rows = [];
const detail = ["", "## Learner Progress Persistence — Test Detail", ""];

for (const { title, result } of tests) {
  const ann = Object.fromEntries(
    (result.annotations || []).map((a) => [a.type, a.description]),
  );
  // course annotation may be "uuid :: title"
  const [course_id, course_title] = (ann.course || "").split(" :: ");
  const status =
    result.status === "passed"
      ? "✅ pass"
      : result.status === "skipped"
      ? "⏭️ skip"
      : "❌ fail";

  rows.push({
    workflow: "learner-progress-persistence",
    status,
    course_id: course_id || ann.course,
    course_title: course_title,
    lesson_id: ann.lesson || ann.pinned_lesson,
    progress_before: ann.progress_before,
    progress_after: ann.progress_after,
    lesson_status_after: ann.lesson_status_after,
    retry_reason: ann.retry_reason,
    notes: ann.precondition,
  });

  detail.push(`### ${status} ${title}`);
  detail.push(`- duration_ms: ${result.duration ?? "—"}`);
  if (result.status !== "passed" && result.error?.message) {
    detail.push("");
    detail.push("```");
    detail.push(result.error.message.slice(0, 800));
    detail.push("```");
  }
  const shots = (result.attachments || []).filter((a) =>
    (a.contentType || "").startsWith("image/"),
  );
  if (shots.length) {
    detail.push(
      `- screenshots: ${shots.map((a) => path.basename(a.path || a.name)).join(", ")}`,
    );
  }
  detail.push("");
}

if (rows.length === 0) {
  appendStepSummary("## Learner Gate — Progress Persistence\n\n_(no tests recorded)_\n");
} else {
  appendStepSummary(
    renderLearnerGateTable(rows, { title: "Learner Gate — Progress Persistence" }),
  );
  appendStepSummary(detail.join("\n"));
}

console.log(`Rendered ${rows.length} learner-gate rows to step summary.`);
