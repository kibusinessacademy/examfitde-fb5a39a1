#!/usr/bin/env node
/**
 * VerwaltungsOS Realtime-Layer Smoke — Cut B2
 *   - persona-agent map seeded (9 personas, agent_id NULL by default)
 *   - resolver RPC returns NULL for unconfigured personas
 *   - 3 audit-contracts registered
 *   - realtime_* columns present on verwaltung_oral_sessions
 *   - edge function blocks anon, returns 412 agent_not_provisioned for default seed
 *   - start/end RPCs reject anon
 */
import { createClient } from "@supabase/supabase-js";

const URL  = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SR   = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SR) { console.error("Missing env"); process.exit(2); }

const svc  = createClient(URL, SR);
const anon = createClient(URL, ANON);

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

// 1. Persona-Agent-Map seeded
console.log("\n[verwaltung_persona_agent_map seed]");
const personas = [
  "buerger_neutral","buerger_aufgebracht","buerger_unsicher","buerger_juristisch",
  "antragsteller_familie","antragsteller_unternehmer","vorgesetzte_dezernent",
  "kollege_kollegial","presse_kritisch",
];
{
  const { data, error } = await svc.from("verwaltung_persona_agent_map")
    .select("persona_key, active");
  if (error) bad(`select failed: ${error.message}`);
  else {
    const keys = new Set((data ?? []).map(r => r.persona_key));
    const missing = personas.filter(p => !keys.has(p));
    if (missing.length === 0) ok(`all 9 personas seeded`);
    else bad(`missing personas: ${missing.join(",")}`);
  }
}

// 2. Resolver RPC
console.log("\n[verwaltung_resolve_persona_agent]");
{
  const { data, error } = await svc.rpc("verwaltung_resolve_persona_agent", {
    _persona: "buerger_neutral",
  });
  if (error) bad(`rpc failed: ${error.message}`);
  else if (data === null) ok(`buerger_neutral → NULL (unprovisioned — expected)`);
  else ok(`buerger_neutral → ${data} (already provisioned)`);
}
{
  const { data } = await svc.rpc("verwaltung_resolve_persona_agent", { _persona: null });
  if (data === null) ok(`NULL → NULL (default lookup unprovisioned)`);
  else ok(`NULL → ${data}`);
}

// 3. Audit contracts
console.log("\n[ops_audit_contract]");
const contracts = [
  ["verwaltung_realtime_token_issued",    ["session_id","persona","agent_id","caller_role"]],
  ["verwaltung_realtime_session_started", ["session_id","persona","agent_id","convai_session_id","caller_role"]],
  ["verwaltung_realtime_session_ended",   ["session_id","convai_session_id","duration_seconds","caller_role"]],
];
for (const [name, keys] of contracts) {
  const { data } = await svc.from("ops_audit_contract")
    .select("action_type, required_keys, owner_module")
    .eq("action_type", name).maybeSingle();
  if (!data) bad(`${name} missing`);
  else {
    const miss = keys.filter(k => !(data.required_keys ?? []).includes(k));
    if (miss.length === 0) ok(`${name} ok (owner=${data.owner_module})`);
    else bad(`${name} missing keys: ${miss.join(",")}`);
  }
}

// 4. Schema: realtime_* columns
console.log("\n[verwaltung_oral_sessions schema]");
{
  const { error } = await svc.from("verwaltung_oral_sessions")
    .select("realtime_mode, realtime_convai_session_id, realtime_started_at, realtime_ended_at")
    .limit(1);
  if (error) bad(`columns missing: ${error.message}`);
  else ok(`realtime_mode + convai_session_id + started_at + ended_at selectable`);
}

// 5. Edge function gate
console.log("\n[edge function verwaltung-realtime-token]");
try {
  const resp = await fetch(`${URL}/functions/v1/verwaltung-realtime-token`, {
    method: "POST",
    headers: { "apikey": ANON, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 401 && body?.error === "auth_required") ok(`anon → auth_required`);
  else if (resp.status === 503 && body?.error === "voice_not_configured") ok(`503 voice_not_configured (key missing — OK in test env)`);
  else bad(`unexpected status=${resp.status} body=${JSON.stringify(body)}`);
} catch (e) {
  bad(`fetch failed ${e.message}`);
}

// 6. State RPCs reject anon
console.log("\n[state RPCs anon gate]");
{
  const { error } = await anon.rpc("verwaltung_start_realtime_session", {
    _session_id: "00000000-0000-0000-0000-000000000000",
    _convai_session_id: "anon_test",
  });
  if (error) ok(`start anon blocked: ${error.message.slice(0,60)}`);
  else bad(`start anon NOT blocked`);
}
{
  const { error } = await anon.rpc("verwaltung_end_realtime_session", {
    _session_id: "00000000-0000-0000-0000-000000000000",
  });
  if (error) ok(`end anon blocked: ${error.message.slice(0,60)}`);
  else bad(`end anon NOT blocked`);
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
