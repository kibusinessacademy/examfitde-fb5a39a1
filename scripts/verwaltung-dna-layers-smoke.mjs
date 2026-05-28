#!/usr/bin/env node
/**
 * VerwaltungsOS DNA-Layers Backfill Smoke
 *
 * Verifiziert, dass alle 40 Fachbereiche jeweils ≥3 roles/kpis/risks und ≥4 processes
 * tragen. Nutzt die existierende RPC get_verwaltung_department_dna (anon-safe).
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!URL || !KEY) { console.error("Missing SUPABASE_URL / KEY"); process.exit(2); }
const sb = createClient(URL, KEY);

const MIN = { roles: 3, processes: 4, kpis: 3, risks: 3 };

const { data: list, error } = await sb.rpc("list_verwaltung_departments");
if (error || !Array.isArray(list)) { console.error("list failed", error); process.exit(1); }

let bad = 0;
for (const d of list) {
  const { data: dna, error: e2 } = await sb.rpc("get_verwaltung_department_dna", {
    _department_key: d.department_key,
  });
  if (e2 || !dna) { console.error(`  ✗ ${d.department_key} detail failed`); bad++; continue; }
  const counts = {
    roles: (dna.roles ?? []).length,
    processes: (dna.processes ?? []).length,
    kpis: (dna.kpis ?? []).length,
    risks: (dna.risks ?? []).length,
  };
  const missing = Object.entries(MIN).filter(([k, v]) => counts[k] < v);
  if (missing.length) {
    bad++;
    console.error(`  ✗ ${d.department_key} unterhalb Mindest: ${missing.map(([k,v])=>`${k}<${v} (=${counts[k]})`).join(", ")}`);
  }
}

if (bad > 0) {
  console.error(`\nDNA-LAYERS SMOKE FAILED — ${bad}/${list.length} Fachbereiche`);
  process.exit(1);
}
console.log(`DNA-LAYERS SMOKE GREEN — ${list.length}/${list.length} Fachbereiche tragen alle 4 Layer (≥${MIN.roles}/${MIN.processes}/${MIN.kpis}/${MIN.risks})`);
