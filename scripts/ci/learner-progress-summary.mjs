#!/usr/bin/env node
/**
 * Learner-Progress-Persistence — CI Artifact Summary
 * ---------------------------------------------------
 * Reads Playwright's JSON report and renders a compact GitHub Step Summary:
 *   - course id + title
 *   - lesson id
 *   - progress_before / progress_after
 *   - lesson_status_after
 *   - retry_reason (if any)
 *   - links to attached screenshots
 *
 * Usage (in CI, after `playwright test --reporter=json,html`):
 *   node scripts/ci/learner-progress-summary.mjs path/to/report.json
 */
import fs from "node:fs";
import path from "node:path";

const reportPath = process.argv[2] || "playwright-report/results.json";
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || "";

if (!fs.existsSync(reportPath)) {
  console.warn(`No JSON report at ${reportPath} — skipping summary.`);
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const lines = ["## Learner Progress Persistence — Run Summary", ""];

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
if (!tests.length) {
  lines.push("_(no tests recorded)_");
} else {
  for (const { title, result } of tests) {
    const ann = Object.fromEntries(
      (result.annotations || []).map((a) => [a.type, a.description]),
    );
    const status = result.status === "passed" ? "✅" : result.status === "skipped" ? "⏭️" : "❌";
    lines.push(`### ${status} ${title}`);
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|---|---|");
    if (ann.course) lines.push(`| Course | \`${ann.course}\` |`);
    if (ann.lesson) lines.push(`| Lesson | \`${ann.lesson}\` |`);
    if (ann.pinned_lesson) lines.push(`| Pinned Lesson | \`${ann.pinned_lesson}\` |`);
    if (ann.precondition) lines.push(`| Precondition | ${ann.precondition} |`);
    if (ann.progress_before !== undefined)
      lines.push(`| progress_before | ${ann.progress_before} |`);
    if (ann.progress_after !== undefined)
      lines.push(`| progress_after | ${ann.progress_after} |`);
    if (ann.lesson_status_after)
      lines.push(`| lesson_status_after | \`${ann.lesson_status_after}\` |`);
    if (ann.retry_reason) lines.push(`| retry_reason | ${ann.retry_reason} |`);
    lines.push(`| duration_ms | ${result.duration ?? "—"} |`);

    if (result.status !== "passed" && result.error?.message) {
      lines.push("");
      lines.push("**Error:**");
      lines.push("```");
      lines.push(result.error.message.slice(0, 800));
      lines.push("```");
    }

    const attachments = (result.attachments || []).filter((a) =>
      (a.contentType || "").startsWith("image/"),
    );
    if (attachments.length) {
      lines.push("");
      lines.push(`**Screenshots:** ${attachments.map((a) => path.basename(a.path || a.name)).join(", ")}`);
    }
    lines.push("");
  }
}

const out = lines.join("\n") + "\n";
if (SUMMARY) fs.appendFileSync(SUMMARY, out);
console.log(out);
