#!/usr/bin/env node
/**
 * VerwaltungsOS Governance Smoke — Cut A3
 *  - anon must be blocked on all 3 RPCs
 *  - service_role payloads have required shape
 *  - audit-contract rows present
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SR  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SR) { console.error("Missing env"); process.exit(2); }

const anon = createClient(URL, ANON);
const svc  = createClient(URL, SR);

let failed = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const bad  = (m) => { console.log(`  ✗ ${m}`); failed++; };

const RPCS = [
  ["verwaltung_governance_audit_trail",       { _window_days: 7, _limit: 50 }, ["summary","recent","generated_at"]],
  ["verwaltung_governance_refusal_quality",   { _window_days: 14 },            ["window_days","totals","by_department","generated_at"]],
  ["verwaltung_governance_source_coverage",   { _window_days: 30 },            ["window_days","totals","dead_workflows","by_department","generated_at"]],
];

for (const [rpc, args, keys] of RPCS) {
  console.log(`\n[${rpc}]`);

  // anon blocked
  {
    const { error } = await anon.rpc(rpc, args);
    if (error && /(forbidden|permission denied|admin role)/i.test(error.message)) {
      ok(`anon blocked: ${error.message}`);
    } else {
      bad(`anon NOT blocked: ${error?.message ?? "no error"}`);
    }
  }

  // svc shape
  {
    const { data, error } = await svc.rpc(rpc, args);
    if (error) { bad(`svc rpc failed: ${error.message}`); continue; }
    for (const k of keys) {
      if (k in data) ok(`has key ${k}`);
      else bad(`missing key ${k}`);
    }
  }
}

console.log("\n[contracts] ops_audit_contract rows");
{
  const { data, error } = await svc
    .from("ops_audit_contract")
    .select("action_type")
    .like("action_type", "verwaltung_governance_%_read");
  if (error) bad(`contract query failed: ${error.message}`);
  else if ((data ?? []).length >= 3) ok(`contracts registered (${data.length})`);
  else bad(`expected ≥3 contracts, got ${data?.length ?? 0}`);
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
