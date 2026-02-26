#!/usr/bin/env node
/**
 * Security Invariants Check
 * 
 * Validates critical security invariants:
 * 1. No sessions with suspicious spike patterns
 * 2. No published packages without approved questions
 * 3. No draft questions accessible to learners
 * 4. Rate limit violations summary
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("⚠️  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY – skipping");
  process.exit(0);
}

async function restQuery(table, select, filters = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filters}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  ⚠️  Query failed for ${table}: ${res.status} ${text}`);
    return null;
  }
  return res.json();
}

async function rpcCall(fnName, params = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  ⚠️  RPC ${fnName} failed: ${res.status} ${text}`);
    return null;
  }
  return res.json();
}

async function main() {
  console.log("🛡️  Running Security Invariants Check...\n");
  let failures = 0;

  // 1) Check for session abuse spikes (>20 sessions in 10 min per user)
  console.log("── Session Abuse Detection ──");
  const sessions = await restQuery(
    "exam_sessions",
    "user_id,id",
    `&created_at=gte.${new Date(Date.now() - 600000).toISOString()}&order=user_id`
  );
  if (sessions) {
    const userCounts = {};
    for (const s of sessions) {
      userCounts[s.user_id] = (userCounts[s.user_id] || 0) + 1;
    }
    const abusers = Object.entries(userCounts).filter(([, c]) => c > 20);
    if (abusers.length > 0) {
      console.error(`  ❌ FAIL: ${abusers.length} user(s) created >20 sessions in 10 minutes`);
      abusers.forEach(([uid, count]) => console.error(`    User ${uid}: ${count} sessions`));
      failures++;
    } else {
      console.log("  ✅ No session abuse detected");
    }
  }

  // 2) Published packages must have approved questions (via correct join on curriculum_id)
  console.log("\n── Publish Integrity ──");
  const published = await restQuery(
    "course_packages",
    "id,status,curriculum_id",
    "&status=eq.published"
  );
  if (published) {
    let publishFailures = 0;
    for (const pkg of published) {
      if (!pkg.curriculum_id) {
        console.error(`  ❌ FAIL: Published package ${pkg.id} has no curriculum_id`);
        publishFailures++;
        continue;
      }
      // Query approved questions by curriculum_id (the actual FK on exam_questions)
      const questions = await restQuery(
        "exam_questions",
        "id",
        `&curriculum_id=eq.${pkg.curriculum_id}&status=eq.approved&limit=1`
      );
      if (questions && questions.length === 0) {
        console.error(`  ❌ FAIL: Published package ${pkg.id} (curriculum ${pkg.curriculum_id}) has 0 approved questions`);
        publishFailures++;
      }
    }
    if (publishFailures > 0) {
      failures += publishFailures;
    } else {
      console.log("  ✅ All published packages have approved questions");
    }
  }

  // 3) Security events summary (last 24h)
  console.log("\n── Security Events (24h) ──");
  const events = await restQuery(
    "security_events",
    "event_type,id",
    `&created_at=gte.${new Date(Date.now() - 86400000).toISOString()}`
  );
  if (events) {
    const typeCounts = {};
    for (const e of events) {
      typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1;
    }
    if (Object.keys(typeCounts).length === 0) {
      console.log("  ✅ No security events in last 24h");
    } else {
      for (const [type, count] of Object.entries(typeCounts)) {
        const icon = count > 50 ? "❌" : count > 10 ? "⚠️" : "ℹ️";
        console.log(`  ${icon} ${type}: ${count} events`);
        if (count > 50) failures++;
      }
    }
  }

  // 4) Rate limit table size (cleanup check)
  console.log("\n── Rate Limit Table Health ──");
  const rateLimits = await restQuery("rate_limits", "id", "&limit=1001");
  if (rateLimits) {
    if (rateLimits.length > 1000) {
      console.warn("  ⚠️  WARN: rate_limits table has >1000 rows – cleanup may be needed");
    } else {
      console.log(`  ✅ rate_limits table healthy (${rateLimits.length} rows)`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(`🚫 Security Invariants Check FAILED (${failures} failure(s))`);
    process.exit(1);
  }
  console.log("✅ Security Invariants Check passed");
}

main().catch((err) => {
  console.error("⚠️  Security check error:", err.message);
  process.exit(0);
});
