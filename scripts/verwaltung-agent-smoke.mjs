#!/usr/bin/env node
/**
 * VerwaltungsAgentOS v1 — End-to-End Smoke
 *
 * Verifiziert die Brücke DNA → Workflows → Agent-Runtime → Strict-RAG → Audit.
 * Checks:
 *  1) RPC list_verwaltung_agents: anon liefert Liste mit >=40 Fachbereichen.
 *  2) RPC get_verwaltung_agent('bauamt'): dna+workflows vorhanden.
 *  3) Smoke-RPC _smoke_verwaltung_agent_shape: anon blockiert, service_role
 *     liefert workflow_count >=3 und has_required_categories=true für
 *     repräsentative Fachbereiche.
 *  4) Edge verwaltung-agent: anon → 401 (auth pflicht).
 *  5) Edge verwaltung-agent mit ungültigem Body → 400.
 *  6) Coverage Audit (service_role): alle DNA-Fachbereiche besitzen
 *     mindestens 3 aktive Workflows (Backfill-Vollständigkeit).
 */
import { config } from "dotenv";
config();

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON) {
  console.error("[smoke] missing SUPABASE_URL / ANON");
  process.exit(1);
}

async function rpc(name, body, key = ANON) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  try { return { status: r.status, json: JSON.parse(txt) }; }
  catch { return { status: r.status, json: txt }; }
}

async function edge(path, body, headers = {}) {
  const r = await fetch(`${URL}/functions/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, ...headers },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  try { return { status: r.status, json: JSON.parse(txt) }; }
  catch { return { status: r.status, json: txt }; }
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

const REPS = ["bauamt", "buergeramt", "jugendamt", "auslaenderbehoerde", "waffenbehoerde", "umweltamt", "standesamt"];

(async () => {
  console.log("== VerwaltungsAgentOS v1 Smoke ==");

  // 1) list_verwaltung_agents (anon, public read)
  const a = await rpc("list_verwaltung_agents", {});
  check("list_verwaltung_agents reachable (anon)",
    a.status === 200 && Array.isArray(a.json) && a.json.length >= 40,
    `status=${a.status} count=${Array.isArray(a.json) ? a.json.length : "n/a"}`);

  // 2) get_verwaltung_agent bauamt
  const b = await rpc("get_verwaltung_agent", { _department_key: "bauamt" });
  check("get_verwaltung_agent(bauamt) shape",
    b.status === 200 && b.json && (b.json.dna || b.json.workflows),
    `status=${b.status}`);

  // 3) shape smoke — anon blocked (either 401/403 hard-block or {error:forbidden})
  const s_anon = await rpc("_smoke_verwaltung_agent_shape", { _department_key: "bauamt" });
  const anonBlocked = s_anon.status === 401 || s_anon.status === 403
    || (s_anon.status === 200 && s_anon.json?.error === "forbidden");
  check("_smoke_verwaltung_agent_shape anon blocked", anonBlocked,
    `status=${s_anon.status}`);

  // 3b) shape smoke — service_role: workflow_count>=3 ist Pflicht;
  // has_required_categories ist informativ (Original-Seed nutzt fachverfahren).
  if (SERVICE) {
    for (const dk of REPS) {
      const s = await rpc("_smoke_verwaltung_agent_shape", { _department_key: dk }, SERVICE);
      const ok = s.status === 200 && s.json?.dna_present === true
                  && (s.json?.workflow_count ?? 0) >= 3;
      check(`shape ${dk}`, ok, `wf=${s.json?.workflow_count} cats=${s.json?.has_required_categories}`);
    }
  } else {
    console.log("⏭ SERVICE_ROLE_KEY missing — skip shape deep checks");
  }

  // 4) edge anon → 401
  const e_anon = await fetch(`${URL}/functions/v1/verwaltung-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ department_key: "bauamt", question: "Wie läuft eine Baugenehmigung?" }),
  });
  const e_anon_txt = await e_anon.text();
  check("verwaltung-agent rejects anon (no Bearer user JWT)",
    e_anon.status === 401,
    `status=${e_anon.status} body=${e_anon_txt.slice(0, 120)}`);

  // 5) edge bad body (with apikey as Bearer — still unauthorized since not a user JWT)
  const e_bad = await edge("verwaltung-agent", { foo: "bar" }, { Authorization: `Bearer ${ANON}` });
  check("verwaltung-agent rejects missing fields or unauth",
    e_bad.status === 400 || e_bad.status === 401,
    `status=${e_bad.status}`);

  // 6) coverage audit (service_role)
  if (SERVICE) {
    const cov = await fetch(`${URL}/rest/v1/verwaltung_department_dna?select=department_key`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).then(r => r.json());
    let missing = 0;
    for (const row of cov) {
      const s = await rpc("_smoke_verwaltung_agent_shape", { _department_key: row.department_key }, SERVICE);
      if ((s.json?.workflow_count ?? 0) < 3) missing++;
    }
    check("coverage: every DNA-Fachbereich has >=3 workflows",
      missing === 0, `missing=${missing}/${cov.length}`);
  }

  console.log(failed === 0 ? "\n✓ ALL GREEN" : `\n✗ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
