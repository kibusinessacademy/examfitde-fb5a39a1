#!/usr/bin/env node
/** BerufAgentOS Cut 2.6 — Mission Control static smoke. */
import { readFileSync, existsSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`✅ ${m}`); pass++; };
const ko = (m) => { console.error(`❌ ${m}`); fail++; };

const lib = readFileSync("src/lib/berufs-ki/outcome.ts", "utf8");
for (const sym of [
  "MissionControlOverview", "CrossProposalConflict", "ExecutiveDecisionRow",
  "MissionControlRecommendation",
  "getMissionControlOverview", "getCrossProposalConflicts", "getExecutiveDecisionQueue",
]) lib.includes(sym) ? ok(`lib exports ${sym}`) : ko(`lib missing ${sym}`);

existsSync("src/pages/admin/berufs-ki/MissionControlPage.tsx")
  ? ok("UI page present") : ko("UI page missing");

const routes = readFileSync("src/routes/AppRoutes.tsx", "utf8");
routes.includes("MissionControlPage") ? ok("route lazy import") : ko("route lazy import missing");
routes.includes("berufs-ki/mission-control") ? ok("route path registered") : ko("route path missing");

let sql = "";
for (const f of readdirSync("supabase/migrations").filter(x => x.endsWith(".sql"))) {
  sql += readFileSync(`supabase/migrations/${f}`, "utf8");
}
for (const sym of [
  "fn_mission_control_recommendation",
  "v_cross_proposal_conflicts",
  "v_executive_decision_queue",
  "admin_get_mission_control_overview",
  "admin_get_cross_proposal_conflicts",
  "admin_get_executive_decision_queue",
]) sql.includes(sym) ? ok(`migration: ${sym}`) : ko(`migration missing ${sym}`);

// HITL guard
const sqlNoComments = sql.replace(/COMMENT ON [\s\S]*?;/g, "").replace(/--[^\n]*/g, "");
const forbidden = /\b(apply_mission_control|auto_apply_decision|mutate_from_mission_control|self_heal_mission_control)\b/i;
forbidden.test(sqlNoComments)
  ? ko("forbidden auto-apply symbol in SQL") : ok("no auto-apply symbols (HITL guard)");

const page = readFileSync("src/pages/admin/berufs-ki/MissionControlPage.tsx", "utf8");
/\b(applyMissionControl|autoApplyDecision|mutateFromMissionControl|selfHealMissionControl|onAutoApply)\b/
  .test(page) ? ko("UI hints at auto-apply hooks") : ok("UI strictly HITL");

// Cross-link to fix-queue + persona-sim from Mission Control
page.includes("/admin/berufs-ki/fix-queue") ? ok("cross-link → fix-queue") : ko("missing fix-queue link");
page.includes("/admin/berufs-ki/persona-sim") ? ok("cross-link → persona-sim") : ko("missing persona-sim link");

// Empty / Loading / Error states
page.includes("Loader2") ? ok("loading state") : ko("no loading state");
/Keine.*Proposals|Keine Konflikte/.test(page) ? ok("empty state") : ko("no empty state");
page.includes("AlertOctagon") || page.includes("Erneut versuchen")
  ? ok("error state") : ko("no error state");

const mem = readFileSync(".lovable/memory/index.md", "utf8");
mem.includes("v2-cut-2-6-mission-control")
  ? ok("memory index references 2.6") : ko("memory index missing 2.6 entry");

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
