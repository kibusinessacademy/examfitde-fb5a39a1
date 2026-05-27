#!/usr/bin/env node
/**
 * Smoke: verwaltung-bund-lagebild edge function
 * - Calls public endpoint (verify_jwt=false) with Berlin ARS
 * - Asserts shape (warnings array, pegel array, meta)
 * - Asserts second call returns cache=hit
 */
const URL_BASE = process.env.SUPABASE_URL || "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";

async function call(body) {
  const r = await fetch(`${URL_BASE}/functions/v1/verwaltung-bund-lagebild`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { status: r.status, json: j };
}

(async () => {
  const a = await call({ ars: "110000000000", region_name: "Berlin", include_pegel: true });
  console.log("call1.status", a.status, "warnings", a.json?.meta?.nina_count, "pegel", a.json?.meta?.pegel_count, "cache", a.json?.meta?.cache);
  if (a.status !== 200) {
    console.error("FAIL: non-200", a.json);
    process.exit(1);
  }
  if (!Array.isArray(a.json.warnings) || !Array.isArray(a.json.pegel)) {
    console.error("FAIL: shape", a.json);
    process.exit(1);
  }
  const b = await call({ ars: "110000000000", region_name: "Berlin", include_pegel: true });
  console.log("call2.cache", b.json?.meta?.cache);
  if (b.json?.meta?.cache !== "hit") {
    console.error("FAIL: expected cache=hit on second call", b.json?.meta);
    process.exit(1);
  }
  console.log("GREEN");
})();
