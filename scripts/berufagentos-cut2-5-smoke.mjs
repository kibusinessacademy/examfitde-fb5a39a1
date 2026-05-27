#!/usr/bin/env node
/** BerufAgentOS Cut 2.5 — Persona Simulation Layer static smoke. */
import { readFileSync, existsSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`✅ ${m}`); pass++; };
const ko = (m) => { console.error(`❌ ${m}`); fail++; };

const lib = readFileSync("src/lib/berufs-ki/outcome.ts", "utf8");
for (const sym of [
  "PersonaKey", "PersonaRegistryEntry", "PersonaSimulation", "PersonaMatrixRow",
  "listPersonas", "getPersonaSimulations", "simulateProposalPersona",
  "clearPersonaSimulation", "getPersonaConflictMatrix",
]) lib.includes(sym) ? ok(`lib exports ${sym}`) : ko(`lib missing ${sym}`);

existsSync("src/pages/admin/berufs-ki/PersonaSimulationPage.tsx")
  ? ok("UI page present") : ko("UI page missing");

const routes = readFileSync("src/routes/AppRoutes.tsx", "utf8");
routes.includes("PersonaSimulationPage") ? ok("route lazy import") : ko("route lazy import missing");
routes.includes("berufs-ki/persona-sim") ? ok("route path registered") : ko("route path missing");

let sql = "";
for (const f of readdirSync("supabase/migrations").filter(x => x.endsWith(".sql"))) {
  sql += readFileSync(`supabase/migrations/${f}`, "utf8");
}
for (const sym of [
  "persona_key", "persona_registry", "outcome_fix_persona_simulations",
  "v_outcome_fix_persona_matrix", "fn_persona_composite_score",
  "admin_list_personas", "admin_simulate_proposal_persona",
  "admin_clear_persona_simulation", "admin_get_persona_simulations",
  "admin_get_persona_conflict_matrix",
  "persona_simulation_recorded", "persona_simulation_cleared",
]) sql.includes(sym) ? ok(`migration: ${sym}`) : ko(`migration missing ${sym}`);

// 5 personas seeded
for (const k of ["azubi","ausbilder","hr_leitung","berufsschule_ihk","admin_ops"]) {
  sql.includes(`'${k}'`) ? ok(`persona seeded: ${k}`) : ko(`persona missing: ${k}`);
}

// HITL guard: no auto-apply / mutate / self-heal symbols in 2.5 surface
const sqlNoComments = sql.replace(/COMMENT ON [\s\S]*?;/g, "").replace(/--[^\n]*/g, "");
const forbidden = /\b(apply_persona_simulation|auto_apply_persona|mutate_workflow_from_persona|self_heal_persona)\b/i;
forbidden.test(sqlNoComments)
  ? ko("forbidden auto-apply / mutate symbol in SQL") : ok("no auto-apply / mutate symbols (HITL guard)");

const page = readFileSync("src/pages/admin/berufs-ki/PersonaSimulationPage.tsx", "utf8");
/auto.?apply|self.?heal|mutate workflow/i.test(page)
  ? ko("UI hints at auto-apply (forbidden)") : ok("UI strictly HITL");

const mem = readFileSync(".lovable/memory/index.md", "utf8");
mem.includes("v2-cut-2-5-persona-simulation")
  ? ok("memory index references 2.5") : ko("memory index missing 2.5 entry");

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
