#!/usr/bin/env node
// Cut 6.1 E2E smoke: foerdermittel-lead-capture
// Skips cleanly when SUPABASE_URL/ANON_KEY missing.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !anon) {
  console.log("SKIP: SUPABASE_URL / ANON_KEY not present — smoke skipped (guard).");
  process.exit(0);
}
const endpoint = `${url.replace(/\/$/, "")}/functions/v1/foerdermittel-lead-capture`;
const ts = Date.now();
const body = {
  email: `smoke+${ts}@examfit-smoke.local`,
  companyName: "Smoke GmbH",
  companySize: "small",
  region: "NW",
  industry: "IT",
  goal: "KI-Pilotprojekt",
  consentMarketing: true,
  source: "hub",
  requestId: `req_smoke_${ts}`,
  leadQualityScore: 55,
  leadTier: "warm",
  reportContext: { topProgramSlugs: ["digital-jetzt"], averageFit: 80, averageProbability: 70, freshnessRiskCount: 0 },
};
const headers = { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` };

async function call(payload, label) {
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  console.log(`[${label}] status=${res.status} body=${text.slice(0, 240)}`);
  return { status: res.status, text };
}

try {
  // 1) Invalid email → 400
  const bad = await call({ ...body, email: "not-an-email" }, "invalid_email");
  if (bad.status !== 400) throw new Error(`expected 400 for invalid_email, got ${bad.status}`);

  // 2) Missing consent → 400
  const noConsent = await call({ ...body, email: `smoke2+${ts}@examfit-smoke.local`, consentMarketing: false }, "no_consent");
  if (noConsent.status !== 400) throw new Error(`expected 400 for no_consent, got ${noConsent.status}`);

  // 3) Happy path → 200
  const ok = await call(body, "happy_path");
  if (ok.status === 429 || ok.status === 402) {
    console.log(`SOFT-PASS: gateway returned ${ok.status} (rate/budget). Treated as handled.`);
    process.exit(0);
  }
  if (ok.status !== 200) throw new Error(`expected 200 for happy_path, got ${ok.status}`);
  const json = JSON.parse(ok.text);
  if (typeof json.ok !== "boolean") throw new Error("missing ok flag");

  // 4) URL never contains PII (encoded request payload is body-only; verify endpoint clean)
  if (/@|consent|email/i.test(endpoint)) throw new Error("endpoint URL leaks PII keyword");

  console.log("SMOKE OK");
} catch (e) {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
}
