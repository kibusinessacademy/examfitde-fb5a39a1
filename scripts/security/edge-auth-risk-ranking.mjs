#!/usr/bin/env node
/**
 * Top-N risk ranking for legacy edge functions in the auth-contract baseline.
 *
 * Score signals (per function index.ts):
 *   +3  uses SERVICE_ROLE_KEY (true for all baseline)
 *   +2  performs writes  (.insert / .update / .upsert / .delete)
 *   +2  performs deletes specifically
 *   +2  exposes mutating RPCs (.rpc("admin_…") or admin_/grant_/revoke_/heal_/promote_/cancel_/reap_)
 *   +1  reads PII tables (profiles | users | learner_profiles | orders)
 *   +1  triggered via HTTP without `req.method === "POST"` guard
 *   -1  has cron-style guard via x-cron-secret/x-job-runner-key string
 *
 * Output: markdown table of top-N to docs/security/edge-auth-top20.md
 */
import fs from "node:fs";
import path from "node:path";

const FN_DIR = "supabase/functions";
const BASELINE = JSON.parse(
  fs.readFileSync("scripts/security/edge-auth-contract-baseline.json", "utf-8"),
);
const N = Number(process.argv[2] ?? 20);

const rows = [];

for (const name of BASELINE) {
  const file = path.join(FN_DIR, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf-8");

  let score = 3;
  const signals = ["service_role"];

  const writes = /\.(insert|update|upsert)\s*\(/.test(src);
  const deletes = /\.delete\s*\(/.test(src);
  const adminRpc = /\.rpc\(\s*["'](admin_|grant_|revoke_|heal_|promote_|cancel_|reap_)/.test(src);
  const pii = /from\(["'](profiles|users|learner_profiles|orders|learner_course_grants|entitlements)["']\)/.test(src);
  const httpNoMethodGate = !/req\.method\s*===\s*["']POST["']/.test(src);
  const cronSecret = /x-cron-secret|x-job-runner-key/i.test(src);

  if (writes)   { score += 2; signals.push("writes"); }
  if (deletes)  { score += 2; signals.push("deletes"); }
  if (adminRpc) { score += 2; signals.push("admin_rpc"); }
  if (pii)      { score += 1; signals.push("pii"); }
  if (httpNoMethodGate) { score += 1; signals.push("no_method_gate"); }
  if (cronSecret) { score -= 1; signals.push("cron_secret_check"); }

  rows.push({ name, score, signals, loc: src.split("\n").length });
}

rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
const top = rows.slice(0, N);

const out = [
  `# Edge Auth Contract — Top-${N} Risk Ranking`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  `Baseline: ${BASELINE.length} legacy functions, scored by SERVICE_ROLE blast radius.`,
  ``,
  `## Scoring`,
  `+3 service_role · +2 writes · +2 deletes · +2 admin_rpc · +1 pii · +1 no_method_gate · −1 cron_secret_check`,
  ``,
  `| # | Function | Score | Signals | LOC |`,
  `|---|----------|-------|---------|-----|`,
  ...top.map((r, i) => `| ${i + 1} | \`${r.name}\` | **${r.score}** | ${r.signals.join(", ")} | ${r.loc} |`),
  ``,
  `## Refactor procedure`,
  `1. \`import { assertAdmin } from "../_shared/edgeAuthContract.ts"\``,
  `2. \`await assertAdmin(req, "<function-name>")\` as the first statement after CORS preflight.`,
  `3. Remove the entry from \`scripts/security/edge-auth-contract-baseline.json\`.`,
  `4. CI guard will then HARD FAIL any regression.`,
  ``,
].join("\n");

const outPath = "docs/security/edge-auth-top20.md";
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(`✅ Wrote ${outPath} (top ${top.length} of ${rows.length} baseline entries)`);
console.log(`Top 5: ${top.slice(0, 5).map((r) => `${r.name}(${r.score})`).join(", ")}`);
