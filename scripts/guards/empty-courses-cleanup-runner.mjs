#!/usr/bin/env node
/**
 * Empty-Courses Cleanup Runner
 * ----------------------------
 * Walks v_admin_empty_published_courses clusters and demotes / backfills.
 *
 * Options:
 *   --dry-run                list only
 *   --demote-duplicates      demote duplicate_curriculum + duplicate_title
 *   --demote-no-curriculum   demote no_curriculum_phantom
 *   --backfill-candidates    call admin_backfill_course_skeleton on backfill_candidate
 *   --limit=N                cap actions per cluster
 *
 * Output: empty-courses-cleanup.{json,md}
 */
import fs from "node:fs";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !SERVICE) {
  console.error("FATAL: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const DRY = args.has("--dry-run");
const DEMOTE_DUP = args.has("--demote-duplicates");
const DEMOTE_NOCUR = args.has("--demote-no-curriculum");
const BACKFILL = args.has("--backfill-candidates");

async function rpc(name, body = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`RPC ${name} → ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const all = await rpc("admin_get_empty_published_courses");
const buckets = {
  duplicate_curriculum: [],
  duplicate_title: [],
  no_curriculum_phantom: [],
  backfill_candidate: [],
  unknown: [],
};
for (const r of (Array.isArray(all) ? all : [])) {
  (buckets[r.cluster] ?? buckets.unknown).push(r);
}

const results = [];
async function action(course, kind, fn) {
  if (DRY) {
    results.push({ course_id: course.id, title: course.title, cluster: course.cluster, action: kind, ok: null, dry_run: true });
    return;
  }
  try {
    const res = await fn();
    results.push({
      course_id: course.id, title: course.title, cluster: course.cluster, action: kind,
      ok: res?.ok !== false, detail: res,
    });
  } catch (err) {
    results.push({ course_id: course.id, title: course.title, cluster: course.cluster, action: kind, ok: false, error: err.message });
  }
}

function take(list) {
  return LIMIT > 0 ? list.slice(0, LIMIT) : list;
}

if (DEMOTE_DUP) {
  for (const c of take([...buckets.duplicate_curriculum, ...buckets.duplicate_title])) {
    await action(c, "demote", () => rpc("admin_demote_empty_course", { _course_id: c.id, _reason: `auto-cleanup ${c.cluster}` }));
  }
}
if (DEMOTE_NOCUR) {
  for (const c of take(buckets.no_curriculum_phantom)) {
    await action(c, "demote", () => rpc("admin_demote_empty_course", { _course_id: c.id, _reason: "auto-cleanup no_curriculum_phantom" }));
  }
}
if (BACKFILL) {
  for (const c of take(buckets.backfill_candidate)) {
    await action(c, "backfill", () => rpc("admin_backfill_course_skeleton", { _course_id: c.id }));
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  dry_run: DRY,
  totals: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  actions: results.length,
  ok: results.filter((r) => r.ok === true).length,
  failed: results.filter((r) => r.ok === false).length,
  unknown_courses: buckets.unknown.map((c) => ({ id: c.id, title: c.title })),
  results,
};
fs.writeFileSync("./empty-courses-cleanup.json", JSON.stringify(summary, null, 2));

const md = [
  "## Empty-Courses Cleanup Run",
  `dry_run=${DRY} · demote_dup=${DEMOTE_DUP} · demote_no_cur=${DEMOTE_NOCUR} · backfill=${BACKFILL} · limit=${LIMIT || "∞"}`,
  "",
  "| Cluster | Total | Actioned |",
  "|---|---:|---:|",
  ...Object.entries(buckets).map(([k, v]) => `| ${k} | ${v.length} | ${results.filter((r) => r.cluster === k).length} |`),
  "",
  `**OK:** ${summary.ok} · **Failed:** ${summary.failed}`,
].join("\n");
fs.writeFileSync("./empty-courses-cleanup.md", md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
process.exit(0);
