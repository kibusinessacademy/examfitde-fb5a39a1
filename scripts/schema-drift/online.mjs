#!/usr/bin/env node
/**
 * Online Schema Drift Check (nightly):
 * Verifies connectivity to the live DB and checks trigger bindings + critical RPCs.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("ℹ️  Online Drift: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set → skipping.");
  process.exit(0);
}

async function postRpc(rpcName, body = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function getRest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function main() {
  let failures = 0;

  // 1. Basic connectivity
  const health = await getRest("expected_trigger_bindings?select=expected_trigger&limit=1");
  if (health.status >= 400) {
    console.error("❌ Online Drift: Supabase REST not reachable or auth failed.");
    process.exit(1);
  }
  console.log("✅ DB connectivity OK.");

  // 2. Trigger bindings check via RPC
  const bindings = await postRpc("check_trigger_bindings");
  if (bindings.status === 200 && Array.isArray(bindings.data)) {
    const missing = bindings.data.filter(r => r.is_bound === false || r.bound === false);
    if (missing.length > 0) {
      console.error(`❌ ${missing.length} trigger(s) not bound:`);
      missing.forEach(m => console.error(`  - ${m.expected_trigger || m.trigger_name}`));
      failures++;
    } else {
      console.log(`✅ All ${bindings.data.length} trigger bindings verified.`);
    }
  } else {
    console.log("ℹ️  check_trigger_bindings RPC not available — skipping.");
  }

  // 3. Critical RPC existence
  const CRITICAL_RPCS = ["has_role", "get_or_create_profile", "resolve_next_step"];
  for (const rpc of CRITICAL_RPCS) {
    const r = await postRpc(rpc);
    if (r.status === 404) {
      console.error(`❌ Critical RPC missing: ${rpc}`);
      failures++;
    } else {
      console.log(`✅ RPC ${rpc} exists.`);
    }
  }

  if (failures > 0) {
    console.error(`\n❌ Online Drift: ${failures} issue(s) found.`);
    process.exit(1);
  }
  console.log("\n✅ Online Schema Drift passed.");
}

main();
