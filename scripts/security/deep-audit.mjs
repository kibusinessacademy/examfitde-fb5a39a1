#!/usr/bin/env node
/**
 * Deep Audit (nightly)
 *
 * Read-only checks:
 *  [1] Publish integrity (RPC)
 *  [2] Approved questions missing SSOT bindings
 *  [3] Approved questions missing didactic metadata
 *  [4] Security events spike (24h)
 *  [5] Session abuse detection (10 min window)
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY
 */
import { getEnv, restSelect, rpcCall } from "./_lib/rest.mjs";

async function main() {
  const env = getEnv();
  const base = env.SUPABASE_URL;
  const key = env.SERVICE_KEY;

  if (!key) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY – cannot run deep audit.");
    process.exit(1);
  }

  let failures = 0;
  console.log("== Deep Audit ==\n");

  // ── 1) Publish integrity ──
  console.log("[1] Publish integrity");
  const pi = await rpcCall({ base, key, fn: "check_publish_integrity" });
  if (!pi.res.ok) {
    console.error("  ❌ FAIL: check_publish_integrity RPC failed:", pi.res.status);
    failures++;
  } else if ((pi.json ?? []).length > 0) {
    console.error(`  ❌ FAIL: ${pi.json.length} publish integrity violation(s)`);
    pi.json.slice(0, 10).forEach((x) =>
      console.error(`    pkg=${x.package_id} curriculum=${x.curriculum_id} approved_q=${x.approved_q}`)
    );
    failures += pi.json.length;
  } else {
    console.log("  ✅ OK");
  }

  // ── 2) Approved questions missing bindings ──
  console.log("\n[2] Approved questions missing bindings");
  const mb = await restSelect({
    base,
    key,
    table: "exam_questions",
    select: "id,curriculum_id",
    qs: "&status=eq.approved&or=(competency_id.is.null,learning_field_id.is.null)&limit=10",
  });
  if (mb.res.ok && (mb.json ?? []).length > 0) {
    console.error("  ❌ FAIL: approved questions missing competency/LF binding (sample):");
    mb.json.slice(0, 5).forEach((x) => console.error(`    q=${x.id} curriculum=${x.curriculum_id}`));
    failures++;
  } else {
    console.log("  ✅ OK");
  }

  // ── 3) Approved questions missing didactic metadata ──
  console.log("\n[3] Approved questions missing didactic metadata");
  const mm = await restSelect({
    base,
    key,
    table: "exam_questions",
    select: "id",
    qs: "&status=eq.approved&or=(difficulty.is.null,cognitive_level.is.null)&limit=10",
  });
  if (mm.res.ok && (mm.json ?? []).length > 0) {
    console.warn(`  ⚠️  WARN: ${(mm.json ?? []).length} approved question(s) missing difficulty/cognitive_level`);
  } else {
    console.log("  ✅ OK");
  }

  // ── 4) Security events spike (24h) ──
  console.log("\n[4] Security events spike (24h)");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const ev = await restSelect({
    base,
    key,
    table: "security_events",
    select: "event_type,id",
    qs: `&created_at=gte.${since}`,
  });
  if (ev.res.ok) {
    const counts = {};
    for (const e of ev.json ?? []) counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    const entries = Object.entries(counts);
    if (entries.length === 0) {
      console.log("  ✅ no events");
    } else {
      for (const [t, c] of entries) {
        const icon = c > 200 ? "❌" : c > 50 ? "⚠️" : "ℹ️";
        console.log(`  ${icon} ${t}: ${c}`);
        if (c > 200) failures++;
      }
    }
  } else {
    console.warn("  ⚠️  events query failed:", ev.res.status);
  }

  // ── 5) Session abuse detection (10 min window) ──
  console.log("\n[5] Session abuse detection (10 min)");
  const recentSince = new Date(Date.now() - 600_000).toISOString();
  const sess = await restSelect({
    base,
    key,
    table: "exam_sessions",
    select: "user_id,id",
    qs: `&created_at=gte.${recentSince}&order=user_id`,
  });
  if (sess.res.ok) {
    const userCounts = {};
    for (const s of sess.json ?? []) userCounts[s.user_id] = (userCounts[s.user_id] || 0) + 1;
    const abusers = Object.entries(userCounts).filter(([, c]) => c > 20);
    if (abusers.length > 0) {
      console.error(`  ❌ FAIL: ${abusers.length} user(s) created >20 sessions in 10 min`);
      abusers.forEach(([uid, count]) => console.error(`    User ${uid}: ${count} sessions`));
      failures++;
    } else {
      console.log("  ✅ no session abuse detected");
    }
  }

  console.log("\n== Result ==");
  if (failures > 0) {
    console.error(`🚫 Deep Audit FAILED (${failures} failure(s))`);
    process.exit(1);
  }
  console.log("✅ Deep Audit PASSED");
}

main().catch((err) => {
  console.error("⚠️  Deep audit error:", err.message);
  process.exit(1);
});
