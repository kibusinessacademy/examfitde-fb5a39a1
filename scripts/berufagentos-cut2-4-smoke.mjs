#!/usr/bin/env node
/** BerufAgentOS Cut 2.4 — Static smoke (offline). */
import { readFileSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`✅ ${m}`); pass++; };
const ko = (m) => { console.error(`❌ ${m}`); fail++; };

const lib = readFileSync("src/lib/berufs-ki/outcome.ts", "utf8");
for (const sym of [
  "OutcomeFixProposal", "OutcomeFixReviewState", "OutcomeFixReviewDecision",
  "OutcomeFixProposalType", "OutcomeFixProposalSource", "OutcomeFixSummary",
  "listFixProposals", "getFixProposalsSummary", "getFixProposal",
  "proposeOutcomeFix", "submitFixReview", "withdrawFixProposal",
]) lib.includes(sym) ? ok(`lib exports ${sym}`) : ko(`lib missing ${sym}`);

existsSync("src/pages/admin/berufs-ki/OutcomeFixQueuePage.tsx")
  ? ok("UI page present") : ko("UI page missing");

const routes = readFileSync("src/routes/AppRoutes.tsx", "utf8");
routes.includes("OutcomeFixQueuePage") ? ok("route lazy import") : ko("route lazy import missing");
routes.includes("berufs-ki/fix-queue") ? ok("route path registered") : ko("route path missing");

const migs = readFileSync(
  // newest migration with cut 2.4 keywords
  (await import("node:fs/promises")).then ? "" : ""
  , "utf8").catch?.(() => "") ?? "";
// fallback: scan all migrations
import("node:fs/promises").then(async (fs) => {
  const files = (await fs.readdir("supabase/migrations")).filter(f => f.endsWith(".sql"));
  let sql = "";
  for (const f of files) sql += await fs.readFile(`supabase/migrations/${f}`, "utf8");
  for (const sym of [
    "outcome_fix_proposals", "outcome_fix_reviews",
    "outcome_fix_proposal_type", "outcome_fix_proposal_source",
    "outcome_fix_review_state", "outcome_fix_review_decision",
    "fn_outcome_fix_priority",
    "admin_propose_outcome_fix", "admin_submit_fix_review",
    "admin_withdraw_fix_proposal", "admin_list_fix_proposals",
    "admin_get_fix_proposal", "admin_get_fix_proposals_summary",
    "outcome_fix_proposal_recorded", "outcome_fix_proposal_review_decided",
    "outcome_fix_proposal_withdrawn",
  ]) sql.includes(sym) ? ok(`migration: ${sym}`) : ko(`migration missing ${sym}`);

  // Hard rule: no auto-apply
  /apply.*proposal|auto_apply|auto-apply/i.test(sql.replace(/COMMENT ON TABLE[\s\S]*?;/g, ""))
    ? ko("forbidden auto-apply pattern in SQL") : ok("no auto-apply pattern (HITL guard)");

  const mem = readFileSync(".lovable/memory/index.md", "utf8");
  mem.includes("v2-cut-2-4-controlled-recommendations")
    ? ok("memory index updated") : ko("memory index missing 2.4 entry");

  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
