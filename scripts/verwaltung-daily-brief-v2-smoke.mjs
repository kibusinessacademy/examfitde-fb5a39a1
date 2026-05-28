#!/usr/bin/env node
/**
 * VerwaltungsOS DailyBrief v2 Smoke — Cut A1
 * Verifies the new workflow-pressure RPC + view.
 *  - anon must be blocked
 *  - service_role payload has required keys
 *  - classification_mix sums to department_count
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

console.log("\n[1] anon must be blocked");
{
  const { error } = await anon.rpc("verwaltung_daily_brief_workflow_pressure", { _window_days: 7 });
  if (error && /admin role required/i.test(error.message)) ok("anon blocked (admin role required)");
  else bad(`anon NOT blocked: ${error?.message ?? "no error"}`);
}

console.log("\n[2] service_role payload shape");
{
  const { data, error } = await svc.rpc("verwaltung_daily_brief_workflow_pressure", { _window_days: 7 });
  if (error) { bad(`svc rpc failed: ${error.message}`); }
  else {
    const required = ["window_days","generated_at","department_count","pressure_avg","classification_mix","top_pressure","departments"];
    for (const k of required) {
      if (k in data) ok(`has key ${k}`);
      else bad(`missing key ${k}`);
    }
    const mix = data.classification_mix ?? {};
    const sum = Object.values(mix).reduce((a,b) => a + Number(b), 0);
    if (sum === data.department_count) ok(`classification_mix sums to department_count (${sum})`);
    else bad(`mix sum ${sum} != dept count ${data.department_count}`);

    if (Array.isArray(data.top_pressure) && data.top_pressure.length > 0) {
      ok(`top_pressure has ${data.top_pressure.length} entries`);
      const t = data.top_pressure[0];
      const tRequired = ["department_key","classification","pressure_score","workflow_count","top_workflows"];
      for (const k of tRequired) {
        if (k in t) ok(`top_pressure[0].${k} present`);
        else bad(`top_pressure[0].${k} missing`);
      }
    } else bad("top_pressure empty or not array");
  }
}

console.log("\n[3] view is service-role gated");
{
  const { error } = await anon.from("v_verwaltung_workflow_signals").select("department_key").limit(1);
  if (error) ok(`anon read blocked: ${error.message}`);
  else bad("anon read NOT blocked");
}

console.log(failed === 0 ? "\n✅ ALL GREEN" : `\n❌ ${failed} FAIL(S)`);
process.exit(failed === 0 ? 0 : 1);
