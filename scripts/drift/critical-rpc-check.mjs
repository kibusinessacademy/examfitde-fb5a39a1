#!/usr/bin/env node
/**
 * CI Guard: Critical RPC Availability Check
 * Verifies that all essential database RPCs exist and are callable.
 * Prevents deployment if critical functions are missing.
 */

import { resolveSupabaseEnv } from "../_lib/supabase-skip.mjs";

const env = resolveSupabaseEnv({ requireServiceKey: true, scriptName: "critical-rpc-check" });
if (env.skip) process.exit(0);
const SUPABASE_URL = env.url;
const SERVICE_KEY = env.serviceKey;

// Critical RPCs that must exist for the platform to function
const CRITICAL_RPCS = [
  'check_trigger_bindings',
  'has_role',
  'get_or_create_profile',
  'resolve_next_step',
];

async function checkRpc(name) {
  try {
    // Try to call with empty/minimal params — we only care about existence, not success
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({}),
    });
    // 404 = function doesn't exist
    // Anything else (200, 400, 422) = function exists
    return res.status !== 404;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔍 Checking critical RPC availability...\n');
  
  const results = await Promise.all(
    CRITICAL_RPCS.map(async (name) => ({
      name,
      exists: await checkRpc(name),
    }))
  );

  let hasFailure = false;
  for (const { name, exists } of results) {
    if (exists) {
      console.log(`  ✅ ${name}`);
    } else {
      console.error(`  ❌ ${name} — MISSING`);
      hasFailure = true;
    }
  }

  console.log('');
  if (hasFailure) {
    console.error('❌ Critical RPCs missing. Deployment blocked.');
    process.exit(1);
  }
  console.log(`✅ All ${CRITICAL_RPCS.length} critical RPCs available.`);
}

main();
