#!/usr/bin/env node
/**
 * Course Publish Readiness — Level 2 (warn-only) CI test.
 *
 * Verifies, against a real DB (service-role key), that:
 *   1. Publishing an L1-valid course (≥1 module + ≥1 lesson) but L2-incomplete
 *      (no minicheck sets / no ready lessons) SUCCEEDS in default warn mode
 *      and writes `course_publish_readiness_l2_warned` to auto_heal_log
 *      with the expected pipeline metadata.
 *   2. With L2 enforcement enabled (via admin RPC), the same shape is BLOCKED
 *      and `course_publish_readiness_l2_blocked` is recorded.
 *   3. The audit metadata contains all pipeline fields:
 *        lessons_ready, minicheck_sets_total, minicheck_sets_approved,
 *        pending_minicheck_jobs, failed_minicheck_jobs, l2_reasons, l2_mode.
 *
 * Required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { randomUUID } from "node:crypto";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const SR_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!URL_BASE || !SR_KEY) {
  console.error("FATAL: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}

const HEADERS = {
  apikey: SR_KEY,
  Authorization: `Bearer ${SR_KEY}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Prefer: "return=representation",
};

async function rest(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers || {}) },
  });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}
async function rpc(name, args) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(args || {}) });
}

const failures = [];
function check(label, cond, detail) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures.push({ label, detail }); console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`); }
}

const fixtures = { courses: [], modules: [], lessons: [] };

async function pickCurriculum() {
  const r = await rest("curricula?select=id&limit=1");
  if (!r.ok || !r.body?.length) throw new Error(`No curriculum: ${JSON.stringify(r)}`);
  return r.body[0].id;
}

async function makeL1ValidCourse(curriculumId) {
  const id = randomUUID();
  const c = await rest("courses", {
    method: "POST",
    body: JSON.stringify({
      id, title: `[CI-L2] ${id.slice(0, 8)}`,
      curriculum_id: curriculumId, status: "draft",
    }),
  });
  if (!c.ok) throw new Error(`create course: ${JSON.stringify(c)}`);
  fixtures.courses.push(id);

  const lf = await rest(`learning_fields?curriculum_id=eq.${curriculumId}&select=id&limit=1`);
  const lfId = lf.body?.[0]?.id ?? null;
  const m = await rest("modules", {
    method: "POST",
    body: JSON.stringify({ course_id: id, learning_field_id: lfId, title: "[CI] Modul", sort_order: 1 }),
  });
  if (!m.ok) throw new Error(`create module: ${JSON.stringify(m)}`);
  fixtures.modules.push(m.body[0].id);

  const l = await rest("lessons", {
    method: "POST",
    body: JSON.stringify({
      module_id: m.body[0].id, title: "[CI] Lesson",
      step: "einstieg", status: "draft", sort_order: 1,
    }),
  });
  if (!l.ok) throw new Error(`create lesson: ${JSON.stringify(l)}`);
  fixtures.lessons.push(l.body[0].id);
  return id;
}

async function tryPublish(id) {
  return rest(`courses?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "published" }),
  });
}

async function logsForCourse(courseId, actionType) {
  const r = await rest(
    `auto_heal_log?target_id=eq.${courseId}&action_type=eq.${actionType}&select=action_type,result_status,target_type,metadata,created_at&order=created_at.desc&limit=5`,
  );
  return r.body || [];
}

const REQUIRED_META = [
  "lessons_ready", "minicheck_sets_total", "minicheck_sets_approved",
  "pending_minicheck_jobs", "failed_minicheck_jobs", "l2_reasons", "l2_mode",
];

function assertMetaShape(label, entry) {
  for (const k of REQUIRED_META) {
    check(`${label}: metadata.${k} present`, entry?.metadata && k in entry.metadata, entry?.metadata);
  }
  check(
    `${label}: l2_reasons includes NO_READY_LESSONS or NO_MINICHECK_SETS`,
    Array.isArray(entry?.metadata?.l2_reasons) &&
      entry.metadata.l2_reasons.some((r) =>
        ["NO_READY_LESSONS", "NO_MINICHECK_SETS", "MINICHECKS_NOT_APPROVED"].includes(r),
      ),
    entry?.metadata?.l2_reasons,
  );
}

async function cleanup() {
  for (const id of fixtures.lessons) await rest(`lessons?id=eq.${id}`, { method: "DELETE" });
  for (const id of fixtures.modules) await rest(`modules?id=eq.${id}`, { method: "DELETE" });
  for (const id of fixtures.courses) {
    await rest(`courses?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "draft" }) });
    await rest(`courses?id=eq.${id}`, { method: "DELETE" });
  }
}

async function run() {
  console.log("Course Publish Guard L2 — CI test");
  const curriculumId = await pickCurriculum();

  // ── Test 1: warn-only path (default) ──
  console.log("\n[1] L1-valid + L2-incomplete: warn-only allows publish");
  const warnId = await makeL1ValidCourse(curriculumId);
  const r1 = await tryPublish(warnId);
  check("publish accepted (warn-only)", r1.ok, { status: r1.status, body: r1.body });
  const stat1 = await rest(`courses?id=eq.${warnId}&select=status`);
  check("course is published", stat1.body?.[0]?.status === "published", stat1.body);
  await new Promise((r) => setTimeout(r, 300));
  const warnLogs = await logsForCourse(warnId, "course_publish_readiness_l2_warned");
  check("auto_heal_log has l2_warned entry", warnLogs.length > 0, warnLogs);
  if (warnLogs[0]) {
    check("warn entry target_type='course'", warnLogs[0].target_type === "course", warnLogs[0]);
    check("warn entry result_status='warned'", warnLogs[0].result_status === "warned", warnLogs[0]);
    check("warn entry l2_mode='warn'", warnLogs[0].metadata?.l2_mode === "warn", warnLogs[0].metadata);
    assertMetaShape("warn", warnLogs[0]);
  }

  // ── Test 2: enforce path via test RPC ──
  console.log("\n[2] L2 enforce mode blocks publish");
  const blockId = await makeL1ValidCourse(curriculumId);
  const enforce = await rpc("admin_force_publish_course_l2_for_test", { _course_id: blockId });
  if (enforce.status === 404) {
    console.log("  (skip) helper RPC admin_force_publish_course_l2_for_test not deployed");
  } else {
    check("enforce RPC rejected (HTTP non-2xx)", !enforce.ok, { status: enforce.status, body: enforce.body });
    const stat2 = await rest(`courses?id=eq.${blockId}&select=status`);
    check("course remained non-published under enforce", stat2.body?.[0]?.status !== "published", stat2.body);
    await new Promise((r) => setTimeout(r, 300));
    const blockedLogs = await logsForCourse(blockId, "course_publish_readiness_l2_blocked");
    check("auto_heal_log has l2_blocked entry", blockedLogs.length > 0, blockedLogs);
    if (blockedLogs[0]) {
      check("blocked entry result_status='blocked'", blockedLogs[0].result_status === "blocked", blockedLogs[0]);
      check("blocked entry l2_mode='enforce'", blockedLogs[0].metadata?.l2_mode === "enforce", blockedLogs[0].metadata);
      assertMetaShape("blocked", blockedLogs[0]);
    }
  }

  await cleanup();

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} assertions failed`);
    process.exit(1);
  }
  console.log("\nOK: course publish guard L2 verified");
}

run().catch(async (e) => {
  console.error("FATAL:", e?.message || e);
  try { await cleanup(); } catch {}
  process.exit(2);
});
