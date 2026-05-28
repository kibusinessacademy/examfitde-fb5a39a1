#!/usr/bin/env node
/**
 * VerwaltungsOS Modernization Smoke — Cut A4
 *  - anon blocked on RPC
 *  - service_role payload shape OK
 *  - audit-contract row present
 *  - top_workflows shape valid
 */
import { createClient } from "@supabase/supabase-js";

const URL  = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SR   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SR) { console.error("Missing env"); process.exit(2); }

const anon = createClient(URL, ANON);
const svc  = createClient(URL, SR);

let failed = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const bad  = (m) => { console.log(`  ✗ ${m}`); failed++; };

const RPC  = "verwaltung_modernization_opportunities";
const ARGS = { _limit: 25 };

console.log(`\n[${RPC}]`);

// 1. anon blocked
{
  const { error } = await anon.rpc(RPC, ARGS);
  if (error && /(forbidden|permission denied|admin role)/i.test(error.message)) {
    ok(`anon blocked: ${error.message}`);
  } else {
    bad(`anon NOT blocked: ${error?.message ?? "no error"}`);
  }
}

// 2. svc payload shape
{
  const { data, error } = await svc.rpc(RPC, ARGS);
  if (error) {
    bad(`svc rpc failed: ${error.message}`);
  } else {
    for (const k of ["generated_at", "totals", "by_department"]) {
      if (k in data) ok(`has key ${k}`); else bad(`missing key ${k}`);
    }
    const t = data.totals ?? {};
    for (const k of ["workflows_total","high","medium","low","ok","departments"]) {
      if (k in t) ok(`totals.${k}`); else bad(`missing totals.${k}`);
    }
    const arr = data.by_department;
    if (Array.isArray(arr)) ok(`by_department is array (${arr.length})`);
    else bad(`by_department not array`);

    const first = arr?.[0];
    if (first) {
      for (const k of ["department_key","workflows_total","avg_score","max_score","top_workflows"]) {
        if (k in first) ok(`dept[0].${k}`); else bad(`missing dept[0].${k}`);
      }
      if (Array.isArray(first.top_workflows) && first.top_workflows.length > 0) {
        const w = first.top_workflows[0];
        for (const k of ["workflow_id","workflow_key","opportunity_score","classification","reasons"]) {
          if (k in w) ok(`top[0].${k}`); else bad(`missing top[0].${k}`);
        }
      }
    }
  }
}

// 3. audit-contract
console.log(`\n[ops_audit_contract]`);
{
  const { data, error } = await svc
    .from("ops_audit_contract")
    .select("action_type,required_keys")
    .eq("action_type", "verwaltung_modernization_opportunities_read")
    .maybeSingle();
  if (error) bad(`contract query failed: ${error.message}`);
  else if (!data) bad(`contract row missing`);
  else {
    ok(`contract registered`);
    const need = ["limit","caller_role"];
    const miss = need.filter((k) => !(data.required_keys ?? []).includes(k));
    if (miss.length === 0) ok(`required_keys ok`);
    else bad(`required_keys missing: ${miss.join(",")}`);
  }
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
