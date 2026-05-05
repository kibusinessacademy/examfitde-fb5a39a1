#!/usr/bin/env node
/**
 * QA Pins Validation (v2 — server-side via qa_pins_validate RPC)
 * --------------------------------------------------------------
 * Hard-fails CI when E2E_QA_COURSE_ID / E2E_QA_LESSON_ID point at data that
 * the learner-progress-persistence gate cannot exercise.
 *
 * Checks (all server-side, single round trip):
 *   1. course exists, status='published'
 *   2. course is "ready" (modules>0, lessons>0)
 *   3. lesson belongs to pinned course
 *   4. lesson is visible (status not placeholder/draft)
 *   5. lesson is startable (not locked)
 *   6. qa_allaccess holds an *active* learner_course_grant for the curriculum
 *
 * Side-effects (CI artifact summary):
 *   Writes a Markdown summary to $GITHUB_STEP_SUMMARY and a JSON file to
 *   ./qa-pins-validation.json so downstream jobs (and humans) can read the
 *   exact state without rerunning.
 *
 * Exit codes:
 *   0 = all pinned data valid (or COURSE_ID intentionally unset → noop)
 *   1 = hard pin failure (block CI)
 *   2 = config / network / RPC error (block CI, distinguishable in logs)
 */
import fs from "node:fs";
import { renderLearnerGateTable, appendStepSummary } from "../ci/_lib/step-summary.mjs";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const COURSE_ID = process.env.E2E_QA_COURSE_ID || "";
const LESSON_ID = process.env.E2E_QA_LESSON_ID || "";
const QA_EMAIL = process.env.E2E_QA_ALLACCESS_EMAIL || "";
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || "";

if (!URL_BASE || !ANON) {
  console.error("FATAL: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing");
  process.exit(2);
}
if (!COURSE_ID) {
  console.log(
    "SKIP: E2E_QA_COURSE_ID not set — falling back to dynamic course pick. " +
      "Set the secret to enable deterministic gating.",
  );
  process.exit(0);
}

async function rpc(name, body) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`RPC ${name} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

function md(report, failures) {
  const c = report.course || {};
  const l = report.lesson;
  const e = report.entitlement;
  const lines = [
    "## QA Pins Validation",
    "",
    `**Course** \`${COURSE_ID}\` — ${c.title ?? "(unknown)"}`,
    "",
    "| Check | Value |",
    "|---|---|",
    `| course.status | \`${c.status ?? "—"}\` |`,
    `| is_published | ${c.is_published ? "✅" : "❌"} |`,
    `| modules | ${c.modules ?? 0} |`,
    `| lessons | ${c.lessons ?? 0} |`,
  ];
  if (l) {
    lines.push(
      "",
      `**Lesson** \`${LESSON_ID}\` — ${l.title ?? "(unknown)"}`,
      "",
      "| Check | Value |",
      "|---|---|",
      `| found | ${l.found ? "✅" : "❌"} |`,
      `| belongs_to_pinned_course | ${l.belongs_to_pinned_course ? "✅" : "❌"} |`,
      `| status | \`${l.status ?? "—"}\` |`,
      `| visible | ${l.visible ? "✅" : "❌"} |`,
      `| locked | ${l.locked ? "🔒 yes" : "✅ no"} |`,
      `| startable | ${l.startable ? "✅" : "❌"} |`,
    );
  }
  if (e) {
    lines.push(
      "",
      `**Entitlement** (\`${QA_EMAIL}\`)`,
      "",
      "| Check | Value |",
      "|---|---|",
      `| email_resolved | ${e.email_resolved ? "✅" : "❌"} |`,
      `| grant_status | \`${e.grant_status ?? "none"}\` |`,
      `| active | ${e.active ? "✅" : "❌"} |`,
    );
  }
  if (failures.length) {
    lines.push("", "### ❌ Failures", ...failures.map((f) => `- ${f}`));
  } else {
    lines.push("", "### ✅ All pins valid");
  }
  return lines.join("\n") + "\n";
}

try {
  const report = await rpc("qa_pins_validate", {
    _course_id: COURSE_ID,
    _lesson_id: LESSON_ID || null,
    _qa_email: QA_EMAIL || null,
  });

  if (!report?.ok) {
    const reason = report?.error || "unknown";
    console.error(`✗ qa_pins_validate returned not ok: ${reason}`);
    if (SUMMARY) fs.appendFileSync(SUMMARY, `## QA Pins Validation\n\n❌ \`${reason}\`\n`);
    fs.writeFileSync("./qa-pins-validation.json", JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const failures = [];
  const c = report.course;
  if (!c.is_published) failures.push(`course status=${c.status} (expected published)`);
  if ((c.modules ?? 0) === 0) failures.push("course has 0 modules");
  if ((c.lessons ?? 0) === 0) failures.push("course has 0 lessons");

  if (LESSON_ID) {
    const l = report.lesson;
    if (!l?.found) failures.push(`lesson ${LESSON_ID} not found`);
    else {
      if (!l.belongs_to_pinned_course)
        failures.push(`lesson does not belong to pinned course ${COURSE_ID}`);
      if (!l.visible) failures.push(`lesson is not visible (status=${l.status})`);
      if (l.locked) failures.push("lesson is locked — qa_allaccess cannot start it");
      if (!l.startable) failures.push("lesson is not startable");
    }
  }

  if (QA_EMAIL) {
    const e = report.entitlement;
    if (!e?.email_resolved) failures.push(`qa_allaccess user ${QA_EMAIL} not resolved`);
    else if (!e.active)
      failures.push(`qa_allaccess grant not active (status=${e.grant_status ?? "none"})`);
  }

  fs.writeFileSync("./qa-pins-validation.json", JSON.stringify(report, null, 2));
  if (SUMMARY) fs.appendFileSync(SUMMARY, md(report, failures));

  console.log("─── QA Pins Validation ───");
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error("─── FAILURES ───");
    failures.forEach((f) => console.error(`✗ ${f}`));
    process.exit(1);
  }
  console.log("✓ All QA pins valid.");
  process.exit(0);
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  if (SUMMARY) fs.appendFileSync(SUMMARY, `## QA Pins Validation\n\n💥 \`${err.message}\`\n`);
  process.exit(2);
}
