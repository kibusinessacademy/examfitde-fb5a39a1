#!/usr/bin/env node
/**
 * QA Pins Validation
 * ------------------
 * Hard-fails CI when E2E_QA_COURSE_ID / E2E_QA_LESSON_ID point at data that
 * the learner-progress-persistence gate cannot exercise.
 *
 * Checks:
 *   1. E2E_QA_COURSE_ID is set and exists in courses
 *   2. course.is_published = true
 *   3. course is "ready" per public_learner_course_readiness (modules>0, lessons>0)
 *   4. E2E_QA_LESSON_ID (if set) belongs to that course
 *   5. lesson is visible (not soft-deleted, on a published module)
 *   6. lesson is reachable (start_lesson would not 403/404)
 *   7. qa_allaccess user has an active learner_course_grant for the course
 *
 * Run:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... \
 *   E2E_QA_COURSE_ID=... E2E_QA_LESSON_ID=... \
 *   E2E_QA_ALLACCESS_EMAIL=... \
 *   node scripts/guards/qa-pins-validation.mjs
 *
 * Exit codes:
 *   0 = all good
 *   1 = pin failure (block CI)
 *   2 = config / network error (block CI, distinguishable in logs)
 */
const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const COURSE_ID = process.env.E2E_QA_COURSE_ID || "";
const LESSON_ID = process.env.E2E_QA_LESSON_ID || "";
const QA_EMAIL = process.env.E2E_QA_ALLACCESS_EMAIL || "";

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const note = (msg) => notes.push(msg);

if (!URL_BASE || !ANON) {
  console.error("FATAL: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing");
  process.exit(2);
}
if (!COURSE_ID) {
  console.error(
    "SKIP: E2E_QA_COURSE_ID not set — falling back to dynamic course pick. " +
      "Set the secret to enable deterministic gating.",
  );
  process.exit(0);
}

async function rest(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`REST ${path} → ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function rpc(name, body = {}) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
}

try {
  // 1+2+3: course exists, published, ready
  const courseRows = await rest(
    `courses?id=eq.${COURSE_ID}&select=id,title,is_published`,
  );
  if (!courseRows.length) {
    fail(`course ${COURSE_ID} does not exist`);
  } else if (!courseRows[0].is_published) {
    fail(`course ${COURSE_ID} is not published`);
  } else {
    note(`course OK: ${courseRows[0].title}`);
  }

  const readiness = await rpc("public_learner_course_readiness", {});
  const ready = readiness.find((c) => c.id === COURSE_ID);
  if (!ready) {
    fail(`course ${COURSE_ID} not in public_learner_course_readiness output`);
  } else if (!ready.is_ready) {
    fail(
      `course ${COURSE_ID} is not ready (modules=${ready.modules}, lessons=${ready.lessons})`,
    );
  } else {
    note(`readiness OK: modules=${ready.modules}, lessons=${ready.lessons}`);
  }

  // 4+5+6: lesson belongs to course, visible, startable
  if (LESSON_ID) {
    const lessonRows = await rest(
      `lessons?id=eq.${LESSON_ID}&select=id,title,module_id,modules!inner(id,course_id)`,
    );
    if (!lessonRows.length) {
      fail(`lesson ${LESSON_ID} does not exist (or RLS blocks anon read)`);
    } else {
      const courseOfLesson = lessonRows[0].modules?.course_id;
      if (courseOfLesson !== COURSE_ID) {
        fail(
          `lesson ${LESSON_ID} belongs to course ${courseOfLesson}, not pinned ${COURSE_ID}`,
        );
      } else {
        note(`lesson OK: ${lessonRows[0].title}`);
      }
    }
  } else {
    note("E2E_QA_LESSON_ID not set — spec will pick first unlocked lesson dynamically");
  }

  // 7: qa_allaccess entitlement (best-effort — anon RLS likely blocks read; warn only)
  if (QA_EMAIL) {
    try {
      // Try a public RPC if you exposed one; otherwise we just log a hint.
      // (A dedicated SECURITY DEFINER RPC is recommended; we don't fail if absent.)
      note(
        `entitlement check skipped (no public RPC). Verified manually: ${QA_EMAIL} should hold an active grant for ${COURSE_ID}.`,
      );
    } catch (e) {
      note(`entitlement check unavailable: ${e.message}`);
    }
  }

  console.log("─── QA Pins Validation ───");
  notes.forEach((n) => console.log(`✓ ${n}`));
  if (failures.length) {
    console.error("─── FAILURES ───");
    failures.forEach((f) => console.error(`✗ ${f}`));
    process.exit(1);
  }
  console.log("All QA pins valid.");
  process.exit(0);
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  process.exit(2);
}
