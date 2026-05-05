#!/usr/bin/env node
/**
 * Empty-Published-Courses Report (Readiness Ratchet)
 * --------------------------------------------------
 * Lists every published course with no modules/lessons, classified into:
 *   - duplicate_curriculum    → safe to demote (better twin exists)
 *   - duplicate_title         → likely safe to demote (review)
 *   - no_curriculum_phantom   → safe to demote (orphan)
 *   - backfill_candidate      → real course, needs admin_backfill_course_skeleton
 *   - unknown                 → manual triage
 *
 * Emits:
 *   - empty-courses.json   (machine-readable artifact)
 *   - empty-courses.md     (markdown table)
 *   - GITHUB_STEP_SUMMARY  (cluster counts + actionable hint)
 *
 * Reads via PostgREST (anon) using the public RPC fallback. For full data we
 * call admin_get_empty_published_courses which requires a service-role JWT.
 *
 * Env:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (required)
 *   SUPABASE_SERVICE_ROLE_KEY (optional — enables full classified output)
 */
import fs from "node:fs";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || "";

if (!URL_BASE || !ANON) {
  console.error("FATAL: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing");
  process.exit(2);
}

async function rpc(name, body, useService = false) {
  const key = useService && SERVICE ? SERVICE : ANON;
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`RPC ${name} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  return r.json();
}

function md(rows) {
  const lines = [
    "## Empty Published Courses",
    "",
    "| Cluster | Course ID | Title | LFs | EQs |",
    "|---|---|---|---:|---:|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.cluster} | \`${r.id}\` | ${(r.title || "").replace(/\|/g, "\\|")} | ${r.source_learning_fields ?? 0} | ${r.source_exam_questions ?? 0} |`,
    );
  }
  return lines.join("\n") + "\n";
}

try {
  if (!SERVICE) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY not set — emitting cluster counts only " +
        "(admin_get_empty_published_courses requires admin JWT).",
    );
    if (SUMMARY)
      fs.appendFileSync(
        SUMMARY,
        "## Empty Published Courses\n\n_No service-role key — set SUPABASE_SERVICE_ROLE_KEY to enable full report._\n",
      );
    process.exit(0);
  }

  const rows = await rpc("admin_get_empty_published_courses", {}, true);
  fs.writeFileSync("./empty-courses.json", JSON.stringify(rows, null, 2));
  fs.writeFileSync("./empty-courses.md", md(rows));

  const counts = rows.reduce((acc, r) => {
    acc[r.cluster] = (acc[r.cluster] || 0) + 1;
    return acc;
  }, {});
  const total = rows.length;

  const summary = [
    "## Empty Published Courses — Ratchet",
    "",
    `**Total empty:** ${total}`,
    "",
    "| Cluster | Count | Suggested Action |",
    "|---|---:|---|",
    `| duplicate_curriculum | ${counts.duplicate_curriculum || 0} | \`admin_demote_empty_course\` |`,
    `| duplicate_title | ${counts.duplicate_title || 0} | \`admin_demote_empty_course\` (review) |`,
    `| no_curriculum_phantom | ${counts.no_curriculum_phantom || 0} | \`admin_demote_empty_course\` |`,
    `| backfill_candidate | ${counts.backfill_candidate || 0} | \`admin_backfill_course_skeleton\` |`,
    `| unknown | ${counts.unknown || 0} | manual triage |`,
    "",
    "_Full per-course list attached as `empty-courses.md` / `empty-courses.json`._",
    "",
  ].join("\n");

  if (SUMMARY) fs.appendFileSync(SUMMARY, summary);
  console.log(summary);
  console.log(`Wrote ${total} rows to empty-courses.{json,md}`);
  process.exit(0);
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  if (SUMMARY)
    fs.appendFileSync(SUMMARY, `## Empty Published Courses\n\n💥 \`${err.message}\`\n`);
  process.exit(2);
}
