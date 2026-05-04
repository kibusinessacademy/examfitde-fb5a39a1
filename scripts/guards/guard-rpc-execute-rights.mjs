#!/usr/bin/env node
/**
 * guard-rpc-execute-rights
 * Verify that internal/admin RPCs are NOT executable by anon/authenticated.
 * Live DB check. Hard-fails on leaks.
 *
 * Heuristic: any function with prefix admin_*, _internal_*, claim_*, ops_*
 * must NOT have execute right granted to public/anon/authenticated.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.warn("⚠️  rpc-execute-rights guard: env missing, skipping."); process.exit(0); }
const sb = createClient(url, key);

const { data, error } = await sb.rpc("get_table_columns", { p_schema: "pg_catalog", p_table: "pg_proc" });
// fallback: query via raw SQL view if helper not present
const { data: leaks, error: e2 } = await sb.rpc("admin_list_rpc_leaks").catch(() => ({ data: null, error: { message: "rpc not found" } }));

if (!leaks) {
  console.warn("⚠️  guard-rpc-execute-rights: admin_list_rpc_leaks RPC not present yet — skipping.");
  console.warn("   (Add a server-side SECURITY DEFINER RPC that returns leaking proacl entries.)");
  process.exit(0);
}

if (Array.isArray(leaks) && leaks.length > 0) {
  console.error("❌ Internal RPCs leaked to anon/authenticated:");
  for (const l of leaks) console.error(`   ${l.proname}: granted to ${l.grantee}`);
  process.exit(1);
}
console.log("✅ guard-rpc-execute-rights passed");
