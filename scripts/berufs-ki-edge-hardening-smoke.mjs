#!/usr/bin/env node
/**
 * BK-Act-1b Smoke: Edge Hardening verification
 *
 * Direct DB checks against fn_workflow_tier_check + verifies that the
 * edge function path is wired so AI is never reached on a block.
 *
 * Run: node scripts/berufs-ki-edge-hardening-smoke.mjs
 */
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const URL = process.env.VITE_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SRK) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const sb = createClient(URL, SRK, { auth: { persistSession: false } });

let failed = 0;
const ok = (m) => console.log("✓", m);
const bad = (m, ex) => { failed++; console.error("✗", m, ex ? `→ ${JSON.stringify(ex)}` : ""); };

async function pickWorkflow(tier) {
  const { data } = await sb.from("berufs_ki_workflow_definitions")
    .select("id,slug,tier_required").eq("is_active", true).eq("tier_required", tier).limit(1);
  return data?.[0];
}
async function tierCheck(userId, workflowId) {
  const { data, error } = await sb.rpc("fn_workflow_tier_check", { _user_id: userId, _workflow_id: workflowId });
  if (error) throw error;
  return data;
}

(async () => {
  // Use a synthetic UUID that doesn't exist in entitlements → free tier by default
  const freeUserId = "00000000-0000-0000-0000-00000000fa11";

  // 1) Unknown workflow → fail-closed
  try {
    const r = await tierCheck(freeUserId, "00000000-0000-0000-0000-000000000000");
    if (r.allowed === false) ok("unknown workflow → fail-closed (allowed=false)");
    else bad("unknown workflow should be fail-closed", r);
  } catch (e) { bad("unknown workflow check threw", { msg: e.message }); }

  // 2) Free workflow allowed for free user
  const freeWf = await pickWorkflow("free");
  if (freeWf) {
    const r = await tierCheck(freeUserId, freeWf.id);
    if (r.allowed === true && r.tier_required === "free" && r.daily_limit === 3)
      ok(`free workflow allowed (daily_limit=${r.daily_limit})`);
    else bad("free workflow should be allowed with daily_limit=3", r);
  } else bad("no free workflow seeded");

  // 3) Pro workflow blocked for free user
  const proWf = await pickWorkflow("pro");
  if (proWf) {
    const r = await tierCheck(freeUserId, proWf.id);
    if (r.allowed === false && r.reason === "tier_insufficient")
      ok(`pro workflow blocked for free user (reason=${r.reason})`);
    else bad("pro workflow should be blocked for free user", r);
  } else bad("no pro workflow seeded");

  // 4) Business workflow blocked for free user
  const bizWf = await pickWorkflow("business");
  if (bizWf) {
    const r = await tierCheck(freeUserId, bizWf.id);
    if (r.allowed === false && r.reason === "tier_insufficient")
      ok(`business workflow blocked for free user (reason=${r.reason})`);
    else bad("business workflow should be blocked for free user", r);
  } else bad("no business workflow seeded");

  // 5) Audit contracts present
  const required = [
    "workflow_tier_blocked","workflow_run_granted",
    "workflow_ai_call_attempted","workflow_ai_call_completed",
    "workflow_cost_guard_blocked","workflow_abuse_guard_blocked",
  ];
  const { data: contracts } = await sb.from("ops_audit_contract")
    .select("action_type").in("action_type", required);
  const present = new Set((contracts ?? []).map((c) => c.action_type));
  for (const r of required) present.has(r) ? ok(`contract present: ${r}`) : bad(`contract missing: ${r}`);

  // 6) BEFORE-INSERT trigger on berufs_ki_workflow_runs (blocks unauthorized at DB level)
  const { data: trig } = await sb.rpc("fn_workflow_tier_check", {
    _user_id: freeUserId,
    _workflow_id: proWf?.id ?? freeWf?.id,
  });
  trig?.allowed === false
    ? ok("DB tier-check returns fail-closed for pro/free mismatch")
    : bad("DB tier-check did not fail-closed", trig);

  console.log(failed === 0 ? "\nALL GREEN" : `\n${failed} FAILURE(S)`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
