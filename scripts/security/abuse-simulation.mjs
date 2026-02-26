#!/usr/bin/env node
/**
 * Abuse Simulation
 * Run: every 6h (cron) + manual
 *
 * Tests:
 *  [1] Rate limit on submit-exam-answer (90 rapid calls)
 *  [2] Idempotency replay consistency
 *  [3] Oversized payload handling (no 5xx)
 *  [4] Export abuse (admin, optional)
 *
 * Requires: TEST_USER_JWT (learner token)
 * Optional: ADMIN_TEST_JWT, DEFAULT_AUDIT_PACKAGE_ID
 */
import { getEnv, fnCall } from "./_lib/rest.mjs";
import { sleep } from "./_lib/http.mjs";

async function main() {
  const env = getEnv();
  const base = env.SUPABASE_URL;
  const learner = env.TEST_USER_JWT;

  if (!learner) {
    console.error("Missing TEST_USER_JWT – cannot run abuse simulation.");
    process.exit(1);
  }

  let failures = 0;
  console.log("== Abuse Simulation ==\n");

  // ── 1) Rate limit: rapid submit calls ──
  console.log("[1] Rate limit on submit-exam-answer");
  let blocked = 0;
  for (let i = 0; i < 90; i++) {
    const { res } = await fnCall({
      base,
      bearer: learner,
      fnName: "submit-exam-answer",
      body: { idempotency_key: `abuse-${Date.now()}-${i}` },
    });
    if (res.status === 429) blocked++;
    await sleep(50);
  }
  if (blocked === 0) {
    console.error("  ❌ FAIL: no 429 blocks observed – rate limit likely ineffective or checked too late");
    failures++;
  } else {
    console.log(`  ✅ rate limit blocks observed: ${blocked}`);
  }

  // ── 2) Idempotency replay ──
  console.log("\n[2] Idempotency replay behavior");
  const key = `replay-${Date.now()}`;
  const payload = { idempotency_key: key };
  const first = await fnCall({ base, bearer: learner, fnName: "submit-exam-answer", body: payload });
  await sleep(200);
  const second = await fnCall({ base, bearer: learner, fnName: "submit-exam-answer", body: payload });
  if (first.res.status !== second.res.status) {
    console.error(`  ❌ FAIL: idempotency replay status mismatch: first=${first.res.status} second=${second.res.status}`);
    failures++;
  } else {
    console.log(`  ✅ idempotency replay consistent (status ${first.res.status})`);
  }

  // ── 3) Oversized payload (should not 5xx) ──
  console.log("\n[3] Oversized payload handling");
  const big = "x".repeat(600_000);
  const over = await fnCall({
    base,
    bearer: learner,
    fnName: "submit-exam-answer",
    body: { idempotency_key: `big-${Date.now()}`, junk: big },
  });
  if (over.res.status >= 500) {
    console.error(`  ❌ FAIL: oversized payload causes server error: ${over.res.status}`);
    failures++;
  } else {
    console.log(`  ✅ oversized payload handled (status ${over.res.status})`);
  }

  // ── 4) Export abuse (admin, optional) ──
  if (env.ADMIN_TEST_JWT) {
    console.log("\n[4] Export abuse (admin)");
    let exportBlocked = 0;
    for (let i = 0; i < 6; i++) {
      const r = await fnCall({
        base,
        bearer: env.ADMIN_TEST_JWT,
        fnName: "export-course-package",
        body: { packageId: env.DEFAULT_AUDIT_PACKAGE_ID || null },
      });
      if (r.res.status === 429) exportBlocked++;
      await sleep(200);
    }
    if (exportBlocked === 0) {
      console.warn("  ⚠️  No export rate-limit blocks observed (check endpoint config)");
    } else {
      console.log(`  ✅ export blocks observed: ${exportBlocked}`);
    }
  } else {
    console.log("\n[4] Export abuse skipped (ADMIN_TEST_JWT not set)");
  }

  console.log("\n== Result ==");
  if (failures > 0) {
    console.error(`🚫 Abuse Simulation FAILED (${failures} failure(s))`);
    process.exit(1);
  }
  console.log("✅ Abuse Simulation PASSED");
}

main().catch((err) => {
  console.error("⚠️  Abuse simulation error:", err.message);
  process.exit(1);
});
