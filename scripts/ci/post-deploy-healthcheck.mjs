#!/usr/bin/env node
/**
 * post-deploy-healthcheck.mjs
 * 
 * After edge function deploy, calls each critical function's health endpoint.
 * If any fails to return { ok: true, health: true }, exits non-zero.
 * 
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ci/post-deploy-healthcheck.mjs
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const CRITICAL_FUNCTIONS = [
  "pipeline-runner",
  "job-runner",
  "stuck-scan",
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkHealth(fnName) {
  const url = `${SUPABASE_URL}/functions/v1/${fnName}?health=1`;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
      });

      if (!res.ok) {
        console.warn(`  ⚠️ ${fnName} attempt ${attempt}: HTTP ${res.status}`);
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
        return { fn: fnName, ok: false, error: `HTTP ${res.status}` };
      }

      const body = await res.json();
      if (body.ok && body.health) {
        return { fn: fnName, ok: true, version: body.version || "unknown" };
      }

      console.warn(`  ⚠️ ${fnName} attempt ${attempt}: unexpected response`, body);
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
      return { fn: fnName, ok: false, error: "health check returned unexpected body", body };
    } catch (e) {
      console.warn(`  ⚠️ ${fnName} attempt ${attempt}: ${e.message}`);
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
      return { fn: fnName, ok: false, error: e.message };
    }
  }
}

async function main() {
  console.log("🏥 Post-Deploy Health Check");
  console.log(`   Checking ${CRITICAL_FUNCTIONS.length} critical functions...\n`);

  const results = await Promise.all(CRITICAL_FUNCTIONS.map(checkHealth));
  
  let allOk = true;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✅ ${r.fn} — healthy (${r.version})`);
    } else {
      console.error(`  ❌ ${r.fn} — FAILED: ${r.error}`);
      allOk = false;
    }
  }

  console.log("");
  if (!allOk) {
    console.error("❌ Post-deploy health check FAILED. One or more critical functions are not bootable.");
    console.error("   Action: Check deploy logs, fix syntax errors, redeploy.");
    process.exit(1);
  }

  console.log("✅ All critical functions are healthy and bootable.");
}

main();
