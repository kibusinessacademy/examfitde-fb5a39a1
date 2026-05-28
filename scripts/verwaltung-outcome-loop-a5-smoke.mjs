#!/usr/bin/env node
/**
 * VerwaltungsOS Outcome-Loop Smoke — Cut A5
 *   - anon blocked on both RPCs
 *   - service_role can capture snapshot (idempotent)
 *   - service_role read returns valid shape (totals, by_department, top_movers)
 *   - audit-contracts registered with required_keys
 */
import { createClient } from "@supabase/supabase-js";

const URL  = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SR   = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SR) { console.error("Missing env"); process.exit(2); }

const anon = createClient(URL, ANON);
const svc  = createClient(URL, SR);

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

// 1. anon blocked on capture
console.log("\n[verwaltung_capture_modernization_snapshot]");
{
  const { error } = await anon.rpc("verwaltung_capture_modernization_snapshot");
  if (error && /(forbidden|permission denied|admin role)/i.test(error.message)) ok(`anon blocked: ${error.message}`);
  else bad(`anon NOT blocked: ${error?.message ?? "no error"}`);
}

// 2. svc capture run #1
let cap1;
{
  const { data, error } = await svc.rpc("verwaltung_capture_modernization_snapshot");
  if (error) bad(`svc capture failed: ${error.message}`);
  else {
    cap1 = data;
    for (const k of ["snapshot_date","workflows_captured","inserted","updated"]) {
      if (k in data) ok(`capture.${k}=${data[k]}`); else bad(`missing ${k}`);
    }
    if ((data.workflows_captured ?? 0) > 0) ok(`captured > 0`); else bad(`captured = 0`);
  }
}

// 3. idempotency — second run within same UTC day → 0 inserted, all updated
{
  const { data, error } = await svc.rpc("verwaltung_capture_modernization_snapshot");
  if (error) bad(`svc capture #2 failed: ${error.message}`);
  else {
    if (data.snapshot_date === cap1.snapshot_date) ok(`idempotent same date`);
    else bad(`date drifted`);
    if (data.inserted === 0) ok(`idempotent: 0 inserted on rerun`);
    else bad(`expected 0 inserted on rerun, got ${data.inserted}`);
  }
}

// 4. anon blocked on outcome-loop
console.log("\n[verwaltung_workflow_outcome_loop]");
{
  const { error } = await anon.rpc("verwaltung_workflow_outcome_loop", { _lookback_days: 30, _limit: 25 });
  if (error && /(forbidden|permission denied|admin role)/i.test(error.message)) ok(`anon blocked: ${error.message}`);
  else bad(`anon NOT blocked`);
}

// 5. svc payload shape
{
  const { data, error } = await svc.rpc("verwaltung_workflow_outcome_loop", { _lookback_days: 30, _limit: 25 });
  if (error) bad(`svc read failed: ${error.message}`);
  else {
    for (const k of ["generated_at","lookback_days","totals","by_department","top_movers"]) {
      if (k in data) ok(`has ${k}`); else bad(`missing ${k}`);
    }
    const t = data.totals ?? {};
    for (const k of ["workflows_total","improved","regressed","stable","no_baseline","departments"]) {
      if (k in t) ok(`totals.${k}`); else bad(`totals missing ${k}`);
    }
    if (Array.isArray(data.by_department)) ok(`by_department array (${data.by_department.length})`);
    else bad(`by_department not array`);
    if (Array.isArray(data.top_movers)) ok(`top_movers array (${data.top_movers.length})`);
    else bad(`top_movers not array`);
    // Bei initialem Capture sind alle NO_BASELINE — workflows_total > 0
    if ((t.workflows_total ?? 0) > 0) ok(`workflows_total > 0`);
    else bad(`workflows_total = 0`);
  }
}

// 6. audit contracts
console.log("\n[ops_audit_contract]");
for (const ac of [
  ["verwaltung_modernization_snapshot_captured", ["snapshot_date","workflows_captured","inserted","updated","caller_role"]],
  ["verwaltung_workflow_outcome_loop_read",      ["lookback_days","limit","caller_role"]],
]) {
  const { data, error } = await svc.from("ops_audit_contract")
    .select("action_type,required_keys").eq("action_type", ac[0]).maybeSingle();
  if (error || !data) bad(`${ac[0]} contract missing`);
  else {
    const miss = ac[1].filter((k) => !(data.required_keys ?? []).includes(k));
    if (miss.length === 0) ok(`${ac[0]} required_keys ok`);
    else bad(`${ac[0]} missing keys: ${miss.join(",")}`);
  }
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
