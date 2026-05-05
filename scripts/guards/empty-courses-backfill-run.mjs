#!/usr/bin/env node
/**
 * Empty-Published-Courses → Backfill Runner
 * -----------------------------------------
 * Iteriert alle `backfill_candidate`-Kurse aus
 * `admin_get_empty_published_courses` und ruft pro Kurs die RPC
 * `admin_backfill_course_skeleton` auf. Reported pro Kurs Erfolg
 * (modules_created/lessons_created) oder Fehler (RPC-Antwort).
 *
 * Schreibt:
 *   - empty-courses-backfill.json      (machine-readable)
 *   - empty-courses-backfill.md        (markdown report)
 *   - GITHUB_STEP_SUMMARY              (kompakter Überblick)
 *
 * ENV:
 *   VITE_SUPABASE_URL                  (required)
 *   SUPABASE_SERVICE_ROLE_KEY          (required — admin-only RPCs)
 *   BACKFILL_LIMIT                     (optional, default = alle)
 *   BACKFILL_DRY_RUN                   ('1' = nur listen, kein Call)
 */
import fs from "node:fs";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || "";
const LIMIT = Number(process.env.BACKFILL_LIMIT || 0);
const DRY_RUN = process.env.BACKFILL_DRY_RUN === "1";

if (!URL_BASE || !SERVICE) {
  console.error("FATAL: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(2);
}

async function rpc(name, body = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`RPC ${name} → ${r.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function appendSummary(md) {
  if (SUMMARY) fs.appendFileSync(SUMMARY, md);
}

try {
  const all = await rpc("admin_get_empty_published_courses");
  const candidates = (Array.isArray(all) ? all : []).filter(
    (r) => r.cluster === "backfill_candidate",
  );
  const targets = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;

  console.log(
    `Found ${candidates.length} backfill_candidate(s); processing ${targets.length}` +
      (DRY_RUN ? " (DRY RUN)" : ""),
  );

  const results = [];
  for (const c of targets) {
    if (DRY_RUN) {
      results.push({
        course_id: c.id,
        title: c.title,
        ok: null,
        skipped: "dry_run",
        learning_fields: c.source_learning_fields ?? 0,
      });
      continue;
    }
    try {
      const res = await rpc("admin_backfill_course_skeleton", { _course_id: c.id });
      results.push({
        course_id: c.id,
        title: c.title,
        ok: res?.ok === true,
        modules_created: res?.modules_created ?? 0,
        lessons_created: res?.lessons_created ?? 0,
        error: res?.ok === false ? res?.error : null,
        sqlstate: res?.sqlstate ?? null,
      });
    } catch (err) {
      results.push({
        course_id: c.id,
        title: c.title,
        ok: false,
        error: err.message,
      });
    }
  }

  const ok = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.skipped).length;
  const totalModules = results.reduce((s, r) => s + (r.modules_created || 0), 0);
  const totalLessons = results.reduce((s, r) => s + (r.lessons_created || 0), 0);

  fs.writeFileSync(
    "./empty-courses-backfill.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        dry_run: DRY_RUN,
        candidates_total: candidates.length,
        processed: targets.length,
        ok,
        failed,
        skipped,
        modules_created: totalModules,
        lessons_created: totalLessons,
        results,
      },
      null,
      2,
    ),
  );

  const lines = [
    "## Empty-Courses Backfill Run",
    "",
    `**Candidates total:** ${candidates.length}  `,
    `**Processed:** ${targets.length}${DRY_RUN ? " _(dry run)_" : ""}  `,
    `**OK:** ${ok} · **Failed:** ${failed} · **Skipped:** ${skipped}  `,
    `**Modules created:** ${totalModules} · **Lessons created:** ${totalLessons}`,
    "",
    "| Status | Course ID | Title | Modules | Lessons | Error |",
    "|---|---|---|---:|---:|---|",
    ...results.map((r) => {
      const status = r.skipped
        ? "⏭️"
        : r.ok === true
          ? "✅"
          : r.ok === false
            ? "❌"
            : "·";
      const title = (r.title || "").replace(/\|/g, "\\|").slice(0, 80);
      const err = (r.error || r.skipped || "").toString().replace(/\|/g, "\\|");
      return `| ${status} | \`${r.course_id}\` | ${title} | ${r.modules_created ?? ""} | ${r.lessons_created ?? ""} | ${err} |`;
    }),
    "",
  ];
  const md = lines.join("\n");
  fs.writeFileSync("./empty-courses-backfill.md", md);
  appendSummary(md);
  console.log(md);

  // Exit 0 always — this is a runner, not a gate. Gate happens in
  // empty-courses-report.mjs / learner-course-readiness.mjs ratchet.
  process.exit(0);
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  appendSummary(`## Empty-Courses Backfill Run\n\n💥 \`${err.message}\`\n`);
  process.exit(2);
}
