#!/usr/bin/env node
/**
 * VerwaltungsOS Realtime Webhook Smoke — Cut B3
 *  - 2 audit-contracts registered
 *  - finalize-RPC service-role gate
 *  - realtime_transcript column present
 *  - webhook rejects missing/invalid signature
 *  - webhook returns 503 if ELEVENLABS_WEBHOOK_SECRET unset (env-tolerant)
 *  - idempotent finalize via fake convai_session_id
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const URL  = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SR   = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SR) { console.error("Missing env"); process.exit(2); }

const svc  = createClient(URL, SR);
const anon = createClient(URL, ANON);

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

// 1. Audit contracts
console.log("\n[ops_audit_contract]");
for (const [name, keys] of [
  ["verwaltung_realtime_webhook_received",  ["convai_session_id","session_id","outcome","caller_role"]],
  ["verwaltung_realtime_debrief_generated", ["convai_session_id","session_id","user_id","overall_score","caller_role"]],
]) {
  const { data } = await svc.from("ops_audit_contract")
    .select("action_type, required_keys, owner_module").eq("action_type", name).maybeSingle();
  if (!data) bad(`${name} missing`);
  else {
    const miss = keys.filter(k => !(data.required_keys ?? []).includes(k));
    if (miss.length === 0) ok(`${name} ok (owner=${data.owner_module})`);
    else bad(`${name} missing: ${miss.join(",")}`);
  }
}

// 2. Schema column
console.log("\n[verwaltung_oral_sessions.realtime_transcript]");
{
  const { error } = await svc.from("verwaltung_oral_sessions").select("realtime_transcript").limit(1);
  if (error) bad(`column missing: ${error.message}`); else ok(`realtime_transcript selectable`);
}

// 3. finalize-RPC service-role gate
console.log("\n[verwaltung_finalize_realtime_session]");
{
  const { error } = await anon.rpc("verwaltung_finalize_realtime_session", {
    _convai_session_id: "smoke_fake_id",
    _transcript: { turns: [] },
    _scores: null,
    _debrief: null,
  });
  if (error) ok(`anon blocked: ${error.message.slice(0,60)}`);
  else bad(`anon NOT blocked`);
}
{
  const { data, error } = await svc.rpc("verwaltung_finalize_realtime_session", {
    _convai_session_id: "smoke_fake_no_session_" + Date.now(),
    _transcript: { turns: [] },
    _scores: null,
    _debrief: null,
  });
  if (error) bad(`service rpc failed: ${error.message}`);
  else if (data?.ok === false && data?.reason === "session_not_found") ok(`session_not_found path ok`);
  else bad(`unexpected: ${JSON.stringify(data)}`);
}

// 4. Webhook endpoint
console.log("\n[edge function verwaltung-realtime-webhook]");
{
  const resp = await fetch(`${URL}/functions/v1/verwaltung-realtime-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { conversation_id: "smoke" } }),
  });
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 503 && body?.error === "webhook_not_configured") ok(`503 webhook_not_configured (secret missing — acceptable in test env)`);
  else if (resp.status === 401 && body?.error === "invalid_signature") ok(`401 invalid_signature (secret set, no sig — correct)`);
  else bad(`unexpected status=${resp.status} body=${JSON.stringify(body)}`);
}

// 5. If secret is set locally, exercise a valid-signature path
const SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
if (SECRET) {
  console.log("\n[webhook valid signature path]");
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ data: { conversation_id: "smoke_unknown_" + Date.now(), transcript: [] } });
  const mac = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  const resp = await fetch(`${URL}/functions/v1/verwaltung-realtime-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "elevenlabs-signature": `t=${ts},v0=${mac}` },
    body,
  });
  const j = await resp.json().catch(() => ({}));
  if (resp.status === 200 && (j?.reason === "session_not_found" || j?.ok === false)) ok(`valid sig + unknown convai_id → session_not_found`);
  else bad(`unexpected: status=${resp.status} body=${JSON.stringify(j)}`);
} else {
  console.log("\n[webhook valid signature path] skipped (ELEVENLABS_WEBHOOK_SECRET not in shell env)");
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
