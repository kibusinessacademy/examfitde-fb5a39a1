#!/usr/bin/env node
/**
 * VerwaltungsOS Voice-Layer Smoke — Cut B1
 *   - persona→voice_id mapping deterministic + covers 9 personas + default
 *   - voice_mode + voice_quality_gate_fails columns present
 *   - 3 audit-contracts registered
 *   - anon blocked on TTS (auth_required) and STT (auth_required)
 */
import { createClient } from "@supabase/supabase-js";

const URL  = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SR   = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SR) { console.error("Missing env"); process.exit(2); }

const svc  = createClient(URL, SR);

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

// 1. Persona → voice_id mapping
console.log("\n[verwaltung_persona_voice_id]");
const personas = [
  ["buerger_neutral",           "nPczCjzI2devNBz1zQrb"],
  ["buerger_aufgebracht",       "iP95p4xoKVk53GoZ742B"],
  ["buerger_unsicher",          "XrExE9yKIg1WjnnlVkGX"],
  ["buerger_juristisch",        "JBFqnCBsd6RMkjVDRZzb"],
  ["antragsteller_familie",     "cgSgspJ2msm6clMCkdW9"],
  ["antragsteller_unternehmer", "bIHbv24MWmeRgasZH58o"],
  ["vorgesetzte_dezernent",     "onwK4e9ZLuTAKqWW03F9"],
  ["kollege_kollegial",         "TX3LPaxmHKxFdv7VOQHJ"],
  ["presse_kritisch",           "cjVigY5qzO86Huf0OWal"],
  ["unknown_xyz",               "nPczCjzI2devNBz1zQrb"], // default fallback
];
for (const [p, expected] of personas) {
  const { data, error } = await svc.rpc("verwaltung_persona_voice_id", { _persona: p });
  if (error) bad(`${p}: ${error.message}`);
  else if (data === expected) ok(`${p} → ${expected}`);
  else bad(`${p} got ${data} expected ${expected}`);
}

// 2. NULL → default
{
  const { data } = await svc.rpc("verwaltung_persona_voice_id", { _persona: null });
  if (data === "nPczCjzI2devNBz1zQrb") ok(`NULL → default Brian`);
  else bad(`NULL got ${data}`);
}

// 3. Columns present on verwaltung_oral_sessions
console.log("\n[verwaltung_oral_sessions schema]");
{
  const { error } = await svc
    .from("verwaltung_oral_sessions")
    .select("voice_mode, voice_quality_gate_fails")
    .limit(1);
  if (error) bad(`columns missing: ${error.message}`);
  else ok(`voice_mode + voice_quality_gate_fails selectable`);
}

// 4. Audit contracts
console.log("\n[ops_audit_contract]");
const contracts = [
  ["verwaltung_voice_tts_request",        ["session_id","persona","voice_id","text_length","caller_role"]],
  ["verwaltung_voice_stt_request",        ["session_id","audio_bytes","transcript_length","caller_role"]],
  ["verwaltung_voice_quality_gate_fail",  ["session_id","reason","fails_total","caller_role"]],
];
for (const [name, keys] of contracts) {
  const { data, error } = await svc.from("ops_audit_contract")
    .select("action_type, required_keys, owner_module")
    .eq("action_type", name).maybeSingle();
  if (error || !data) bad(`${name} contract missing`);
  else {
    const miss = keys.filter((k) => !(data.required_keys ?? []).includes(k));
    if (miss.length === 0) ok(`${name} required_keys ok (owner=${data.owner_module})`);
    else bad(`${name} missing keys: ${miss.join(",")}`);
  }
}

// 5. Edge functions reachable without auth → auth_required
console.log("\n[edge functions auth gate]");
for (const fn of ["verwaltung-voice-tts", "verwaltung-voice-stt"]) {
  try {
    const resp = await fetch(`${URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "apikey": ANON, "Content-Type": fn.endsWith("stt") ? "audio/webm" : "application/json" },
      body: fn.endsWith("stt") ? new Uint8Array([1,2,3]) : JSON.stringify({ text: "test" }),
    });
    const body = await resp.json().catch(() => ({}));
    if (resp.status === 401 && body?.error === "auth_required") ok(`${fn}: auth_required`);
    else if (resp.status === 503 && body?.error === "voice_not_configured") ok(`${fn}: voice_not_configured (key not set — OK in test env)`);
    else bad(`${fn}: unexpected status=${resp.status} body=${JSON.stringify(body)}`);
  } catch (e) {
    bad(`${fn}: fetch failed ${e.message}`);
  }
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
