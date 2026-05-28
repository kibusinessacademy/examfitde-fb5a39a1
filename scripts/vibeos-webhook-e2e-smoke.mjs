#!/usr/bin/env node
/**
 * VibeOS Webhook E2E Smoke — Cut B3 (post ElevenLabs cleanup)
 *
 * Tests all places the webhook is supposed to behave correctly:
 *  1) OPTIONS preflight → 204 + CORS
 *  2) GET (wrong method) → 405
 *  3) POST without signature → 401 invalid_signature + audit signature_invalid
 *  4) POST with bad signature → 401 invalid_signature
 *  5) POST with expired timestamp → 401
 *  6) POST with valid signature + invalid JSON → 400 invalid_json + audit parse_error
 *  7) POST with valid signature + missing session_id → 400 missing_session_id
 *  8) POST with valid signature + unknown session_id → 200 {ok:false, reason:'session_not_found'} + audit accepted
 *  9) POST with valid signature + REAL session → 200 {ok:true, finalize:{...}} + DB row updated + AI debrief written
 * 10) Re-POST same session → 200 {ok:true, idempotent:true}
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";

const URL    = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SR     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.VIBEOS_WEBHOOK_SECRET;
if (!URL || !SR || !SECRET) {
  console.error("Missing env (need VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + VIBEOS_WEBHOOK_SECRET)");
  process.exit(2);
}

const svc = createClient(URL, SR);
const EP  = `${URL}/functions/v1/verwaltung-realtime-webhook`;

let failed = 0, passed = 0;
const ok  = (m) => { console.log(`  ✓ ${m}`); passed++; };
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

function sign(body, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return { ts: String(ts), sig, header: `t=${ts},v0=${sig}` };
}

async function post({ body = "{}", header = null, method = "POST", extraHeaders = {} } = {}) {
  const h = { "Content-Type": "application/json", ...extraHeaders };
  if (header) h["vibeos-signature"] = header;
  const r = await fetch(EP, { method, headers: h, body: method === "POST" ? body : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: r.status, json, text, headers: Object.fromEntries(r.headers) };
}

console.log(`\nVibeOS Webhook E2E — ${EP}\n`);

// 1) OPTIONS preflight
{
  const r = await fetch(EP, { method: "OPTIONS" });
  await r.text();
  if (r.status === 204) ok("OPTIONS → 204");
  else bad(`OPTIONS → ${r.status}`);
  const allow = r.headers.get("access-control-allow-headers") ?? "";
  if (allow.includes("vibeos-signature")) ok("CORS allows vibeos-signature header");
  else bad(`CORS allow-headers missing vibeos-signature: ${allow}`);
}

// 2) Wrong method
{
  const r = await post({ method: "GET" });
  if (r.status === 405) ok("GET → 405 method_not_allowed");
  else bad(`GET → ${r.status} ${r.text.slice(0,100)}`);
}

// 3) No signature
{
  const r = await post({ body: JSON.stringify({ session_id: "x", transcript: [] }) });
  if (r.status === 401 && r.json?.error === "invalid_signature") ok("no signature → 401 invalid_signature");
  else bad(`no sig → ${r.status} ${JSON.stringify(r.json)}`);
}

// 4) Bad signature
{
  const body = JSON.stringify({ session_id: "x", transcript: [] });
  const ts = Math.floor(Date.now() / 1000);
  const r = await post({ body, header: `t=${ts},v0=deadbeef` });
  if (r.status === 401) ok("bad signature → 401");
  else bad(`bad sig → ${r.status} ${JSON.stringify(r.json)}`);
}

// 5) Expired timestamp
{
  const body = JSON.stringify({ session_id: "x", transcript: [] });
  const { header } = sign(body, Math.floor(Date.now() / 1000) - 3600); // 1h ago > 30min tolerance
  const r = await post({ body, header });
  if (r.status === 401) ok("expired timestamp (>30min) → 401");
  else bad(`expired → ${r.status} ${JSON.stringify(r.json)}`);
}

// 6) Valid signature + invalid JSON
{
  const body = "not-json";
  const { header } = sign(body);
  const r = await post({ body, header });
  if (r.status === 400 && r.json?.error === "invalid_json") ok("valid sig + bad JSON → 400 invalid_json");
  else bad(`bad json → ${r.status} ${JSON.stringify(r.json)}`);
}

// 7) Valid signature + missing session_id
{
  const body = JSON.stringify({ transcript: [{ role: "user", content: "hallo" }] });
  const { header } = sign(body);
  const r = await post({ body, header });
  if (r.status === 400 && r.json?.error === "missing_session_id") ok("valid sig + no session_id → 400 missing_session_id");
  else bad(`no session_id → ${r.status} ${JSON.stringify(r.json)}`);
}

// 8) Valid signature + unknown session_id
{
  const fakeId = randomUUID();
  const body = JSON.stringify({
    session_id: fakeId,
    transcript: [{ role: "user", content: "test" }, { role: "persona", content: "antwort" }],
  });
  const { header } = sign(body);
  const r = await post({ body, header });
  if (r.status === 200 && r.json?.ok === false && r.json?.reason === "session_not_found") {
    ok(`unknown session → 200 session_not_found (audit-only path)`);
  } else bad(`unknown session → ${r.status} ${JSON.stringify(r.json)}`);
}

// 9) Real session — create one, post, verify DB update
console.log("\n[Real session round-trip]");

// Pick a real user_id from auth.users (any one)
const { data: u, error: ue } = await svc.rpc("get_verwaltung_department_dna", { _department_key: "buergeramt" })
  .then(async (r) => {
    if (r.error) return { error: r.error };
    // direct query auth.users via SQL? Use service-role rest
    const res = await fetch(`${URL}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    });
    const rows = await res.json();
    return { data: rows?.[0] };
  });

if (ue || !u?.id) {
  bad(`no user available for real-session test: ${ue?.message ?? "no profiles"}`);
} else {
  const userId = u.id;
  // Insert a session directly via SQL function — use service-role insert
  const insertRes = await fetch(`${URL}/rest/v1/verwaltung_oral_sessions`, {
    method: "POST",
    headers: {
      apikey: SR, Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      department_key: "buergeramt",
      oral_case_key: "vibeos_webhook_smoke",
      persona: "buerger_neutral",
      conflict_level: "medium",
      status: "active",
      scenario_snapshot: { category: "Service", title: "Smoke" },
    }),
  });
  const inserted = await insertRes.json();
  const sessionRow = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!sessionRow?.id) {
    bad(`session insert failed: ${JSON.stringify(inserted).slice(0,300)}`);
  } else {
    ok(`created test session ${sessionRow.id}`);

    const body = JSON.stringify({
      session_id: sessionRow.id,
      external_id: "e2e-smoke-" + Date.now(),
      transcript: [
        { role: "persona", content: "Guten Tag, ich brauche einen neuen Personalausweis." },
        { role: "user",    content: "Gerne. Bringen Sie bitte ein biometrisches Passfoto und Ihren alten Ausweis mit. Die Gebühr beträgt 37 Euro." },
        { role: "persona", content: "Geht das auch schneller? Ich brauche das in einer Woche." },
        { role: "user",    content: "Im Express-Verfahren ja, gegen Aufpreis. Soll ich Ihnen den Termin direkt buchen?" },
      ],
      metadata: { source: "vibeos-webhook-e2e-smoke" },
    });
    const { header } = sign(body);

    const t0 = Date.now();
    const r = await post({ body, header });
    const dt = Date.now() - t0;
    if (r.status === 200 && r.json?.ok === true && r.json?.finalize) {
      ok(`real session → 200 ok (${dt}ms, AI-debrief generated)`);
    } else {
      bad(`real session → ${r.status} ${JSON.stringify(r.json).slice(0,400)}`);
    }

    // Verify DB
    const verifyRes = await fetch(`${URL}/rest/v1/verwaltung_oral_sessions?id=eq.${sessionRow.id}&select=status,scores,debrief,realtime_transcript`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    });
    const [row] = await verifyRes.json();
    if (row?.scores?.overall !== undefined && row?.scores?.per_dim) ok(`DB: scores.per_dim+overall written (overall=${row.scores.overall})`);
    else bad(`DB: scores missing: ${JSON.stringify(row?.scores).slice(0,200)}`);
    if (row?.debrief?.scorecard) ok(`DB: debrief.scorecard written`);
    else bad(`DB: debrief.scorecard missing`);
    if (row?.realtime_transcript?.turns?.length === 4) ok(`DB: realtime_transcript.turns=4`);
    else bad(`DB: transcript turns=${row?.realtime_transcript?.turns?.length}`);

    // 10) Idempotency
    const r2 = await post({ body, header: sign(body).header });
    if (r2.status === 200 && r2.json?.idempotent === true) ok("re-post → idempotent:true");
    else bad(`re-post → ${r2.status} ${JSON.stringify(r2.json)}`);

    // Cleanup
    await fetch(`${URL}/rest/v1/verwaltung_oral_sessions?id=eq.${sessionRow.id}`, {
      method: "DELETE", headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    });
  }
}

// Verify audit trail for last accepted webhook
console.log("\n[Audit trail]");
const auditRes = await fetch(`${URL}/rest/v1/auto_heal_log?action_type=eq.verwaltung_realtime_webhook_received&order=created_at.desc&limit=5&select=created_at,result_status,metadata,input_params`, {
  headers: { apikey: SR, Authorization: `Bearer ${SR}` },
});
const audits = await auditRes.json();
if (Array.isArray(audits) && audits.length >= 3) {
  ok(`recent webhook audits: ${audits.length} rows`);
  const outcomes = new Set(audits.map(a => a.metadata?.outcome ?? a.input_params?.outcome).filter(Boolean));
  console.log(`     outcomes seen: ${[...outcomes].join(", ")}`);
} else {
  bad(`audit trail missing: ${JSON.stringify(audits).slice(0,200)}`);
}

console.log(`\n${failed === 0 ? "✅ GREEN" : `❌ FAILED ${failed}/${passed+failed}`} (${passed} passed)\n`);
process.exit(failed === 0 ? 0 : 1);
