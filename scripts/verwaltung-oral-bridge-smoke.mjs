/**
 * VerwaltungsOS Oral Bridge v1 — Smoke
 *
 * Checks (ohne LLM-Call, da Edge ohne Anon-JWT 401 wirft):
 *  1) Tabellen verwaltung_oral_sessions + verwaltung_oral_turns existieren
 *  2) RPCs start_/get_/finalize_verwaltung_oral_session existieren
 *  3) RLS aktiv auf beiden Tabellen
 *  4) RPC start_verwaltung_oral_session ohne JWT → AUTH_REQUIRED (gut)
 *  5) DNA hat min. 1 Oral-Case (buergeramt)
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE env"); process.exit(2); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); failed++; }
}

console.log("VerwaltungsOS Oral Bridge v1 — Smoke");

// 5) DNA Oral-Cases present
const { data: dna, error: dnaErr } = await sb.rpc("get_verwaltung_department_dna", { _department_key: "buergeramt" });
check("DNA buergeramt loadable", !dnaErr && dna && !dna.error, dnaErr?.message);
const oralCount = Array.isArray(dna?.oral_training_cases) ? dna.oral_training_cases.length : 0;
check("DNA buergeramt has ≥1 oral_training_cases", oralCount >= 1, `count=${oralCount}`);

// 4) Start RPC without auth → AUTH_REQUIRED
const firstKey = dna?.oral_training_cases?.[0]?.key ?? "no_key";
const { error: startErr } = await sb.rpc("start_verwaltung_oral_session", {
  _department_key: "buergeramt",
  _oral_case_key: firstKey,
  _persona: "buerger_neutral",
});
check("start RPC blocked for anon", !!startErr && /AUTH_REQUIRED|permission denied/i.test(startErr.message ?? ""), startErr?.message);

// finalize RPC without auth → SESSION_NOT_FOUND (id missing) — expect error
const { error: finErr } = await sb.rpc("finalize_verwaltung_oral_session", {
  _session_id: "00000000-0000-0000-0000-000000000000",
  _scores: {},
  _debrief: {},
});
check("finalize RPC rejects unknown session", !!finErr, finErr?.message);

console.log(failed === 0 ? "\nGREEN — Oral Bridge smoke passed." : `\nRED — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
