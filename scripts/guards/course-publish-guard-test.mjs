#!/usr/bin/env node
/**
 * Course Publish Readiness Guard — CI integration test.
 *
 * Verifies, against a real DB (service-role key), that:
 *   1. Publishing a course without modules/lessons is BLOCKED by the trigger.
 *   2. The block is recorded in auto_heal_log with the canonical contract.
 *   3. A course with ≥1 module and ≥1 lesson CAN be published.
 *   4. The admin bypass GUC `app.transition_source='admin_force_publish'`
 *      allows force-publish AND writes an auto_heal_log bypass entry.
 *
 * Cleanup: every fixture row is removed at the end (best-effort).
 *
 * Required env:
 *   - VITE_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
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
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: r.ok, status: r.status, body };
}

async function rpc(name, args) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(args || {}) });
}

const failures = [];
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push({ label, detail });
    console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
  }
}

const fixtures = { courses: [], modules: [], lessons: [] };

async function pickCurriculum() {
  const r = await rest(
    "curricula?select=id&limit=1",
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    throw new Error(`No curriculum available: ${JSON.stringify(r)}`);
  }
  return r.body[0].id;
}

async function createCourse(curriculumId, opts = {}) {
  const id = randomUUID();
  const r = await rest("courses", {
    method: "POST",
    body: JSON.stringify({
      id,
      title: `[CI-PublishGuard] ${id.slice(0, 8)}`,
      curriculum_id: curriculumId,
      status: opts.status || "draft",
    }),
  });
  if (!r.ok) throw new Error(`create course failed: ${JSON.stringify(r)}`);
  fixtures.courses.push(id);
  return id;
}

async function tryPublish(courseId) {
  return rest(`courses?id=eq.${courseId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "published" }),
  });
}

async function addModuleAndLesson(courseId, curriculumId) {
  const lf = await rest(
    `learning_fields?curriculum_id=eq.${curriculumId}&select=id&limit=1`,
  );
  const lfId = lf.body?.[0]?.id ?? null;
  const modR = await rest("modules", {
    method: "POST",
    body: JSON.stringify({
      course_id: courseId,
      learning_field_id: lfId,
      title: "[CI] Modul",
      sort_order: 1,
    }),
  });
  if (!modR.ok) throw new Error(`create module failed: ${JSON.stringify(modR)}`);
  const moduleId = modR.body[0].id;
  fixtures.modules.push(moduleId);

  const lesR = await rest("lessons", {
    method: "POST",
    body: JSON.stringify({
      module_id: moduleId,
      title: "[CI] Lesson",
      step: "einstieg",
      status: "draft",
      sort_order: 1,
    }),
  });
  if (!lesR.ok) throw new Error(`create lesson failed: ${JSON.stringify(lesR)}`);
  fixtures.lessons.push(lesR.body[0].id);
}

async function logsForCourse(courseId, actionType) {
  const r = await rest(
    `auto_heal_log?target_id=eq.${courseId}&action_type=eq.${actionType}&select=action_type,result_status,target_type,metadata,created_at&order=created_at.desc&limit=5`,
  );
  return r.body || [];
}

async function cleanup() {
  // Best-effort. Lessons → Modules → Courses.
  for (const id of fixtures.lessons) {
    await rest(`lessons?id=eq.${id}`, { method: "DELETE" });
  }
  for (const id of fixtures.modules) {
    await rest(`modules?id=eq.${id}`, { method: "DELETE" });
  }
  for (const id of fixtures.courses) {
    // demote first to bypass any "published" guards on delete cascades
    await rest(`courses?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "draft" }),
    });
    await rest(`courses?id=eq.${id}`, { method: "DELETE" });
  }
}

async function run() {
  console.log("Course Publish Guard — CI test");
  const curriculumId = await pickCurriculum();
  console.log(`  curriculum_id=${curriculumId}`);

  // ── Test 1: empty course → publish blocked ──
  console.log("\n[1] Empty course must be blocked");
  const emptyId = await createCourse(curriculumId);
  const r1 = await tryPublish(emptyId);
  check(
    "empty course publish is rejected (HTTP non-2xx)",
    !r1.ok,
    { status: r1.status, body: r1.body },
  );
  // Confirm it stayed draft
  const stat1 = await rest(`courses?id=eq.${emptyId}&select=status`);
  check(
    "empty course status remained non-published",
    stat1.body?.[0]?.status !== "published",
    stat1.body,
  );
  // Allow log to settle
  await new Promise((r) => setTimeout(r, 250));
  const blockedLogs = await logsForCourse(
    emptyId,
    "course_publish_readiness_blocked",
  );
  check(
    "auto_heal_log has course_publish_readiness_blocked entry",
    blockedLogs.length > 0,
    blockedLogs,
  );
  if (blockedLogs.length > 0) {
    const e = blockedLogs[0];
    check(
      "blocked log target_type='course'",
      e.target_type === "course",
      e,
    );
    check(
      "blocked log metadata includes modules/lessons counts",
      typeof e.metadata?.modules === "number" &&
        typeof e.metadata?.lessons === "number",
      e.metadata,
    );
  }

  // ── Test 2: full course → publish succeeds ──
  console.log("\n[2] Course with modules+lessons can be published");
  const fullId = await createCourse(curriculumId);
  await addModuleAndLesson(fullId, curriculumId);
  const r2 = await tryPublish(fullId);
  check("full course publish accepted", r2.ok, { status: r2.status, body: r2.body });
  const stat2 = await rest(`courses?id=eq.${fullId}&select=status`);
  check(
    "full course status is published",
    stat2.body?.[0]?.status === "published",
    stat2.body,
  );

  // ── Test 3: admin bypass (GUC) on empty course logs bypass ──
  console.log("\n[3] Admin force-publish bypass writes audit + succeeds");
  const bypassId = await createCourse(curriculumId);
  const bypass = await rpc("admin_force_publish_course_for_test", {
    _course_id: bypassId,
  });
  if (bypass.status === 404) {
    console.log(
      "  (skip) helper RPC admin_force_publish_course_for_test not deployed",
    );
  } else {
    check("bypass RPC accepted", bypass.ok, bypass);
    const stat3 = await rest(`courses?id=eq.${bypassId}&select=status`);
    check(
      "bypass course status is published",
      stat3.body?.[0]?.status === "published",
      stat3.body,
    );
    await new Promise((r) => setTimeout(r, 250));
    const bypassLogs = await logsForCourse(
      bypassId,
      "course_publish_readiness_bypassed",
    );
    check(
      "auto_heal_log has course_publish_readiness_bypassed entry",
      bypassLogs.length > 0,
      bypassLogs,
    );
  }

  await cleanup();

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} assertions failed`);
    process.exit(1);
  }
  console.log("\nOK: course publish guard verified");
}

run().catch(async (e) => {
  console.error("FATAL:", e?.message || e);
  try {
    await cleanup();
  } catch {}
  process.exit(2);
});
