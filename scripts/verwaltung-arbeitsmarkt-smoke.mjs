#!/usr/bin/env node
/**
 * Smoke: VerwaltungsOS — Arbeitsmarkt-Lagebild v1
 * Ruft die Edge-Function verwaltung-arbeitsmarkt mit einer Verwaltungs-typischen
 * Berufsbezeichnung auf und prüft Pass-Through-Vertrag (jobs[], aggregation, source).
 */
const PROJECT_REF = "ubdvvvsiryenhrfmqsvw";
const ANON = "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";
const URL = `https://${PROJECT_REF}.supabase.co/functions/v1/verwaltung-arbeitsmarkt`;

async function call(body) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  const failures = [];

  // 1) Pflicht-Parameter fehlt → 400
  const a = await call({});
  if (a.status !== 400) failures.push(`[missing-was] expected 400, got ${a.status}`);

  // 2) Erfolgreiche Verwaltungs-Suche
  const b = await call({ was: "Verwaltungsfachangestellte", size: 10, page: 1 });
  if (b.status !== 200) failures.push(`[basic] expected 200, got ${b.status}: ${JSON.stringify(b.json)}`);
  if (!b.json?.jobs || !Array.isArray(b.json.jobs)) failures.push(`[basic] jobs[] missing`);
  if (!b.json?.aggregation) failures.push(`[basic] aggregation missing`);
  if (!b.json?.source?.includes("Bundesagentur")) failures.push(`[basic] source missing/wrong`);
  if (b.json?.jobs?.length && !b.json.jobs[0].source) failures.push(`[basic] per-item source missing`);

  // 3) Mit Ort + Umkreis
  const c = await call({ was: "Sachbearbeiter", wo: "Berlin", umkreis: 25, size: 5 });
  if (c.status !== 200) failures.push(`[geo] expected 200, got ${c.status}`);

  console.log(JSON.stringify({
    a: a.status,
    b: { status: b.status, jobs: b.json?.jobs?.length, total: b.json?.aggregation?.total, top_ag: b.json?.aggregation?.top_arbeitgeber?.length },
    c: { status: c.status, jobs: c.json?.jobs?.length },
  }, null, 2));

  if (failures.length) { console.error("FAIL\n" + failures.join("\n")); process.exit(1); }
  console.log("\n✓ verwaltung-arbeitsmarkt smoke GREEN");
})();
