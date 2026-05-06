#!/usr/bin/env node
/**
 * Soft-launch summary: aggregates phase breadcrumbs + Playwright JSON results
 * into a single text + JSON report for quick gate decisions.
 *
 * Reads:
 *   test-results/results.json              (Playwright JSON reporter)
 *   test-results/phase-breadcrumbs/*.json  (per-suite last seen phase)
 *
 * Writes:
 *   test-results/soft-launch-summary.json
 *   test-results/soft-launch-summary.txt
 *
 * Usage: node scripts/ci/soft-launch-summary.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("test-results");
const RESULTS = path.join(ROOT, "results.json");
const BC_DIR = path.join(ROOT, "phase-breadcrumbs");

const SUITES = [
  { spec: "learner-entitlement-flow.spec.ts", key: "learner-entitlement-flow", required: true },
  { spec: "purchase-checkout-smoke.spec.ts", key: "purchase-checkout-smoke", required: true },
  { spec: "learner-minicheck-persistence.spec.ts", key: "learner-minicheck-persistence", required: false },
  { spec: "oral-exam.spec.ts", key: "oral-exam", required: false },
];

function loadResults() {
  if (!fs.existsSync(RESULTS)) return null;
  try { return JSON.parse(fs.readFileSync(RESULTS, "utf8")); } catch { return null; }
}
function loadBreadcrumb(key) {
  const f = path.join(BC_DIR, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

function findSuiteStatus(results, specName) {
  if (!results?.suites) return "unknown";
  const walk = (suites) => {
    for (const s of suites) {
      if (s.file?.endsWith(specName) || s.title?.endsWith(specName)) {
        const specs = s.specs ?? [];
        const allTests = specs.flatMap((sp) => sp.tests ?? []);
        if (!allTests.length) return "no-tests";
        if (allTests.every((t) => t.status === "skipped")) return "skipped";
        if (allTests.some((t) => (t.results ?? []).some((r) => r.status === "failed" || r.status === "timedOut"))) return "failed";
        if (allTests.every((t) => (t.results ?? []).some((r) => r.status === "passed"))) return "passed";
        return "unknown";
      }
      const nested = walk(s.suites ?? []);
      if (nested) return nested;
    }
    return null;
  };
  return walk(results.suites) ?? "unknown";
}

const results = loadResults();
const summary = SUITES.map(({ spec, key, required }) => {
  const status = results ? findSuiteStatus(results, spec) : "no-results";
  const bc = loadBreadcrumb(key);
  return {
    suite: key,
    spec,
    required,
    status,
    lastPhase: bc?.currentPhase ?? null,
    phaseHistory: bc?.phaseHistory ?? [],
    attempt: bc?.attempt ?? null,
  };
});

const allRequiredGreen = summary.filter((s) => s.required).every((s) => s.status === "passed");
const verdict = allRequiredGreen ? "SOFT_LAUNCH_JA" : "SOFT_LAUNCH_NEIN";

fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, "soft-launch-summary.json"), JSON.stringify({ verdict, summary }, null, 2));

const text = [
  `# Soft Launch Summary`,
  ``,
  `Verdict: ${verdict === "SOFT_LAUNCH_JA" ? "✅ JA" : "❌ NEIN"}`,
  ``,
  `## Per-Suite Verdict`,
  ...summary.map((s) => {
    const icon = s.status === "passed" ? "✅" : s.status === "failed" ? "❌" : s.status === "skipped" ? "⏭️" : "❔";
    const tag = s.required ? "REQUIRED" : "OPTIONAL";
    const phase = s.lastPhase ? ` — last phase: ${s.lastPhase}${s.attempt != null ? ` (attempt=${s.attempt})` : ""}` : "";
    return `- ${icon} [${tag}] ${s.suite}: ${s.status}${phase}`;
  }),
  ``,
  `## Final Verdict: ${verdict}`,
].join("\n");
fs.writeFileSync(path.join(ROOT, "soft-launch-summary.txt"), text);
console.log(text);
process.exit(verdict === "SOFT_LAUNCH_JA" ? 0 : 1);
