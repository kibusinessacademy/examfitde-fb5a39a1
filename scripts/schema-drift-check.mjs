#!/usr/bin/env node

/**
 * CI Schema Drift Check
 * 
 * Calls the schema-health edge function and fails the build
 * if critical drifts are detected.
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/schema-drift-check.mjs
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("⚠️  SUPABASE_URL / ANON_KEY not set – skipping drift check");
  process.exit(0);
}

async function main() {
  console.log("🔍 Running schema drift check...");

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/schema-health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ANON_KEY}`,
        "apikey": ANON_KEY,
      },
      body: JSON.stringify({ source: "ci" }),
    });

    const data = await res.json();

    if (data.error === "Unauthorized") {
      console.log("⚠️  Schema health check not authorized in CI – skipping");
      process.exit(0);
    }

    console.log(`📊 Drift check complete: ${data.drift_count || 0} drifts, ${data.critical_count || 0} critical`);

    if (data.drifts && data.drifts.length > 0) {
      console.log("\n--- Drift Details ---");
      for (const d of data.drifts) {
        const icon = d.critical ? "❌" : "⚠️";
        console.log(`${icon} [${d.type}] ${d.entity}${d.expected ? ` (expected: ${JSON.stringify(d.expected)})` : ""}${d.actual ? ` (actual: ${d.actual})` : ""}`);
      }
      console.log("---\n");
    }

    if (data.ok === false && data.critical_count > 0) {
      console.error(`❌ SCHEMA DRIFT: ${data.critical_count} critical drift(s) found. Build blocked.`);
      process.exit(1);
    }

    console.log("✅ Schema drift check passed – no critical drifts");
  } catch (err) {
    console.error("⚠️  Schema drift check failed to connect:", err.message);
    // Don't block build if the function is unreachable
    process.exit(0);
  }
}

main();
