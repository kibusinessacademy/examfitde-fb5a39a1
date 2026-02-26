#!/usr/bin/env node
/**
 * Security Smoke Test
 * Run: hourly (cron) + manual
 *
 * Tests:
 *  [A] RLS: anon cannot read exam_questions
 *  [B] Publish integrity (RPC)
 *  [C] Security events summary (24h)
 *  [D] Rate-limit table health
 */
import { getEnv, restSelect, rpcCall } from "./_lib/rest.mjs";

async function main() {
  const env = getEnv();
  const base = env.SUPABASE_URL;
  let failures = 0;

  console.log("== Security Smoke ==\n");

  // ── A) RLS: anon must NOT read exam_questions ──
  if (env.ANON_KEY) {
    console.log("[A] RLS / Exfil (anon)");
    // A1: basic access check
    const q = await restSelect({
      base,
      key: env.ANON_KEY,
      table: "exam_questions",
      select: "id",
      qs: "&limit=1",
    });
    const blocked =
      q.res.status === 401 ||
      q.res.status === 403 ||
      (Array.isArray(q.json) && q.json.length === 0);
    if (!blocked) {
      console.error("  ❌ FAIL: anon can access exam_questions:", q.res.status, q.text.slice(0, 300));
      failures++;
    } else {
      console.log("  ✅ anon cannot read exam_questions");
    }

    // A2: leak check – if 200, verify no sensitive fields exposed
    if (q.res.status === 200 && Array.isArray(q.json) && q.json.length > 0) {
      const sensitive = await restSelect({
        base,
        key: env.ANON_KEY,
        table: "exam_questions",
        select: "id,correct_answer,explanation",
        qs: "&limit=1",
      });
      if (sensitive.res.status === 200 && Array.isArray(sensitive.json) && sensitive.json.length > 0) {
        const row = sensitive.json[0];
        if (row.correct_answer !== undefined || row.explanation !== undefined) {
          console.error("  ❌ FAIL: anon can read correct_answer/explanation – DATA LEAK!");
          failures++;
        }
      }
    }
  } else {
    console.warn("  ⚠️  ANON_KEY missing – skipping anon RLS test");
  }

  // ── B) Publish integrity ──
  if (env.SERVICE_KEY) {
    console.log("\n[B] Publish Integrity (RPC)");
    const r = await rpcCall({ base, key: env.SERVICE_KEY, fn: "check_publish_integrity" });
    if (!r.res.ok) {
      console.error("  ❌ FAIL: check_publish_integrity RPC failed:", r.res.status, r.text.slice(0, 300));
      failures++;
    } else {
      const bad = Array.isArray(r.json) ? r.json : [];
      if (bad.length > 0) {
        console.error(`  ❌ FAIL: ${bad.length} published package(s) violate integrity`);
        bad.slice(0, 10).forEach((x) =>
          console.error(`    pkg=${x.package_id} curriculum=${x.curriculum_id} approved_q=${x.approved_q}`)
        );
        failures += bad.length;
      } else {
        console.log("  ✅ publish integrity OK");
      }
    }

    // ── C) Security events (24h) ──
    console.log("\n[C] Security events (24h)");
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const ev = await restSelect({
      base,
      key: env.SERVICE_KEY,
      table: "security_events",
      select: "event_type,id",
      qs: `&created_at=gte.${since}`,
    });
    if (!ev.res.ok) {
      console.warn("  ⚠️  events query failed:", ev.res.status);
    } else {
      const counts = {};
      for (const e of ev.json ?? []) counts[e.event_type] = (counts[e.event_type] || 0) + 1;
      const entries = Object.entries(counts);
      if (entries.length === 0) {
        console.log("  ✅ no security events in last 24h");
      } else {
        for (const [t, c] of entries) {
          const icon = c > 200 ? "❌" : c > 50 ? "⚠️" : "ℹ️";
          console.log(`  ${icon} ${t}: ${c}`);
          if (c > 200) failures++;
        }
      }
    }

    // ── D) Rate-limit table health ──
    console.log("\n[D] Rate-limit table health");
    const rl = await restSelect({
      base,
      key: env.SERVICE_KEY,
      table: "rate_limits",
      select: "user_key",
      qs: "&limit=1001",
    });
    if (rl.res.ok) {
      const count = (rl.json ?? []).length;
      if (count > 1000) {
        console.warn(`  ⚠️  rate_limits has >1000 rows (${count}) – cleanup may be needed`);
      } else {
        console.log(`  ✅ rate_limits healthy (${count} rows)`);
      }
    }
  } else {
    console.warn("  ⚠️  SERVICE_KEY missing – skipping RPC + events tests");
  }

  console.log("\n== Result ==");
  if (failures > 0) {
    console.error(`🚫 Security Smoke FAILED (${failures} failure(s))`);
    process.exit(1);
  }
  console.log("✅ Security Smoke PASSED");
}

main().catch((err) => {
  console.error("⚠️  Smoke error:", err.message);
  process.exit(1);
});
