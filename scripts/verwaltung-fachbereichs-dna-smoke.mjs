#!/usr/bin/env node
/**
 * VerwaltungsOS Fachbereichs-DNA v1 — Smoke
 *
 * Validiert:
 *  1. list_verwaltung_departments liefert ≥40 Fachbereiche
 *  2. KGSt-Cluster vollständig (alle Departments haben category)
 *  3. get_verwaltung_department_dna(buergeramt) liefert Pflichtfelder
 *  4. Jeder Fachbereich hat ≥1 Use-Case
 *  5. Mindestens ein Department hat ≥1 Oral-Training-Case
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / KEY env");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function ok(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }

async function run() {
  console.log("VerwaltungsOS Fachbereichs-DNA v1 — Smoke");

  // 1. list
  const { data: list, error: listErr } = await supabase.rpc("list_verwaltung_departments");
  if (listErr || !Array.isArray(list)) return fail(`list RPC failed: ${listErr?.message}`);
  if (list.length < 40) return fail(`expected ≥40 departments, got ${list.length}`);
  ok(`list_verwaltung_departments → ${list.length} Fachbereiche`);

  // 2. clusters
  const missingCat = list.filter((d) => !d.category);
  if (missingCat.length > 0) fail(`${missingCat.length} departments ohne category`);
  else ok(`alle ${list.length} Fachbereiche haben KGSt-Cluster`);

  const clusters = new Set(list.map((d) => d.category));
  ok(`Cluster: ${[...clusters].join(", ")}`);

  // 3. detail
  const { data: detail, error: detErr } = await supabase.rpc("get_verwaltung_department_dna", {
    _department_key: "buergeramt",
  });
  if (detErr || !detail) return fail(`detail RPC failed: ${detErr?.message}`);
  const required = ["department_key", "department_name", "category", "use_cases", "oral_training_cases"];
  const missing = required.filter((k) => !(k in detail));
  if (missing.length) fail(`detail missing keys: ${missing.join(",")}`);
  else ok("get_verwaltung_department_dna(buergeramt) hat alle Pflichtfelder");

  // 4. use cases coverage
  const noUseCases = list.filter((d) => (d.use_cases_count ?? 0) < 1);
  if (noUseCases.length > 0) fail(`${noUseCases.length} Fachbereiche ohne Use-Cases`);
  else ok(`alle ${list.length} Fachbereiche haben ≥1 Use-Case`);

  // 5. oral training coverage
  const oralTotal = list.reduce((s, d) => s + (d.oral_cases_count ?? 0), 0);
  if (oralTotal < 1) fail("kein Oral-Training-Szenario gefunden");
  else ok(`${oralTotal} Oral-Training-Szenarien insgesamt (${list.filter((d) => d.oral_cases_count > 0).length} Fachbereiche)`);

  if (process.exitCode === 1) {
    console.error("\nSMOKE FAILED");
  } else {
    console.log("\nSMOKE GREEN");
  }
}

run().catch((e) => { console.error(e); process.exit(2); });
