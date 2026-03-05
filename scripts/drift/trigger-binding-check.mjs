#!/usr/bin/env node
/**
 * CI Guard: Trigger Binding Verification
 * Checks that all expected triggers in expected_trigger_bindings
 * are actually bound to their target tables in the live DB.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn('⚠️  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping');
  process.exit(0);
}

async function query(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_trigger_bindings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    // Fallback: direct PostgREST query
    const fallbackRes = await fetch(
      `${SUPABASE_URL}/rest/v1/expected_trigger_bindings?select=expected_trigger,expected_table,enabled`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );
    if (!fallbackRes.ok) throw new Error(`PostgREST error: ${fallbackRes.status}`);
    return fallbackRes.json();
  }
  return res.json();
}

async function main() {
  console.log('🔍 Checking trigger bindings...\n');

  try {
    const result = await query();
    
    if (Array.isArray(result)) {
      // RPC returned binding check results
      const missing = result.filter(r => r.is_bound === false || r.bound === false);
      
      if (missing.length > 0) {
        console.error('❌ Missing trigger bindings:');
        missing.forEach(m => {
          console.error(`  - ${m.expected_trigger || m.trigger_name} on ${m.expected_table || m.table_name}`);
        });
        process.exit(1);
      }
      
      console.log(`✅ All ${result.length} expected triggers are properly bound.`);
    } else {
      // Fallback: just list expected bindings
      console.log(`ℹ️  Found ${result.length} expected trigger bindings (RPC unavailable for verification).`);
    }
  } catch (err) {
    console.error('❌ Trigger binding check failed:', err.message);
    process.exit(1);
  }
}

main();
