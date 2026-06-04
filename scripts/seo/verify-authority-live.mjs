#!/usr/bin/env node
/**
 * verify-authority-live.mjs
 *
 * Schneller Post-Deploy-Check: holt 3 Routen von berufos.com und meldet,
 * ob per-Route-HTML ausgeliefert wird (statt identischer SPA-Shell).
 *
 * Heuristik:
 *  - SPA-Shell = alle Routen liefern denselben Title UND ~20 KB Body.
 *  - Per-Route-HTML = unterschiedliche Titles oder deutlich unterschiedliche Body-Größen.
 *
 * Exit:
 *   0 = per-Route-HTML OK
 *   1 = SPA-Shell-Drift (Prerender nicht live)
 *   2 = Netzwerk-/HTTP-Fehler
 *
 * Usage:
 *   node scripts/seo/verify-authority-live.mjs [--host=berufos.com] [--retries=5] [--delay=15]
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || true];
  }),
);
const HOST = String(args.host || "berufos.com");
const RETRIES = Number(args.retries || 5);
const DELAY_S = Number(args.delay || 15);
const PATHS = ["/", "/preise", "/berufe"];
const SPA_TITLE = "ExamFit – KI-Prüfungstraining für IHK & AEVO";

async function probe(path) {
  const url = `https://${HOST}${path}`;
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const body = await r.text();
  const m = body.match(/<title>([^<]*)<\/title>/i);
  return {
    path,
    size: body.length,
    title: m ? m[1].trim() : null,
    vercel: r.headers.get("x-vercel-id"),
  };
}

async function runOnce() {
  const results = [];
  for (const p of PATHS) results.push(await probe(p));
  const titles = new Set(results.map((r) => r.title));
  const allSpaTitle = results.every((r) => r.title === SPA_TITLE);
  const sizeBand = results.every((r) => r.size >= 19000 && r.size <= 22000);
  const drift = allSpaTitle && sizeBand;
  return { results, drift, distinctTitles: titles.size };
}

console.log(`▶ Verifying per-route HTML on ${HOST} (retries=${RETRIES}, delay=${DELAY_S}s)`);

let lastErr;
for (let attempt = 1; attempt <= RETRIES; attempt++) {
  try {
    const { results, drift, distinctTitles } = await runOnce();
    console.log(`\n[attempt ${attempt}/${RETRIES}]`);
    for (const r of results) {
      console.log(`  ${r.path}  ${r.size}b  vercel=${r.vercel || "—"}  title="${r.title || ""}"`);
    }
    if (!drift) {
      console.log(`\n✅ Per-Route-HTML OK — ${distinctTitles} distinct titles across ${PATHS.length} routes`);
      process.exit(0);
    }
    console.log(`⚠ SPA-Shell drift detected (all routes share title + size band)`);
  } catch (e) {
    lastErr = e;
    console.log(`[attempt ${attempt}] ${e.message}`);
  }
  if (attempt < RETRIES) await new Promise((res) => setTimeout(res, DELAY_S * 1000));
}

if (lastErr) {
  console.error(`\n❌ Network/HTTP failure: ${lastErr.message}`);
  process.exit(2);
}
console.error(`\n❌ DRIFT — ${HOST} still serves identical SPA shell on / /preise /berufe`);
console.error(`   → Prerender output NOT reaching the live deployment.`);
console.error(`   → See docs/runbooks/vercel-domain-mapping-ssot.md`);
process.exit(1);
