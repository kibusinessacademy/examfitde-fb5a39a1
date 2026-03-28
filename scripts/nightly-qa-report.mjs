#!/usr/bin/env node
/**
 * Nightly QA Report Generator
 *
 * Runs all unit test suites and produces a structured JSON report
 * for CI artifacts and admin dashboard consumption.
 *
 * Usage:
 *   node scripts/nightly-qa-report.mjs [--json] [--ci]
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const JSON_OUT = process.argv.includes("--json");
const CI_MODE = process.argv.includes("--ci");
const ROOT = process.cwd();

function nowIso() {
  return new Date().toISOString();
}

function runCommand(cmd, args = []) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: process.env,
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseSuiteFromVitest(stdout) {
  const lines = stdout.split("\n");
  const suiteResults = [];
  let totalPass = 0, totalFail = 0, totalSkip = 0;

  for (const line of lines) {
    // Match vitest output lines like "✓ suite name > test name (5ms)"
    const passMatch = line.match(/✓\s+(.+?)\s+\((\d+)\s*ms\)/);
    if (passMatch) {
      totalPass++;
      suiteResults.push({ name: passMatch[1].trim(), status: "pass", duration_ms: parseInt(passMatch[2]) });
    }

    const failMatch = line.match(/×\s+(.+)/);
    if (failMatch) {
      totalFail++;
      suiteResults.push({ name: failMatch[1].trim(), status: "fail", duration_ms: 0 });
    }

    const skipMatch = line.match(/↓\s+(.+)/);
    if (skipMatch) {
      totalSkip++;
      suiteResults.push({ name: skipMatch[1].trim(), status: "skip", duration_ms: 0 });
    }
  }

  // Parse summary line: "Tests  60 passed (60)"
  const summaryMatch = stdout.match(/Tests\s+(\d+)\s+passed/);
  if (summaryMatch) totalPass = parseInt(summaryMatch[1]);

  const failSummary = stdout.match(/(\d+)\s+failed/);
  if (failSummary) totalFail = parseInt(failSummary[1]);

  return { results: suiteResults, totalPass, totalFail, totalSkip };
}

const SUITES = [
  {
    key: "nightly_audit",
    label: "Nightly Audit: Published Quality",
    pattern: "src/features/admin/__tests__/nightlyAuditPublishedQuality",
  },
  {
    key: "learner_golden_path",
    label: "Learner Golden Path Logic",
    pattern: "src/features/admin/__tests__/learnerGoldenPath",
  },
  {
    key: "admin_preview",
    label: "Admin Preview & Auto-Test-Queue",
    pattern: "src/features/admin/__tests__/adminPreviewAutoTestQueue",
  },
  {
    key: "edge_contracts",
    label: "Edge Function Contracts",
    pattern: "src/features/admin/__tests__/edgeFunctionContracts",
  },
  {
    key: "qa_feedback_loop",
    label: "QA Feedback Loop Scoring",
    pattern: "src/features/admin/__tests__/qaFeedbackLoop",
  },
];

async function main() {
  const startedAt = nowIso();
  const suiteResults = [];

  for (const suite of SUITES) {
    const start = Date.now();
    const exec = await runCommand("npx", ["vitest", "run", suite.pattern, "--reporter=verbose"]);
    const duration = Date.now() - start;
    const parsed = parseSuiteFromVitest(exec.stdout + exec.stderr);

    suiteResults.push({
      key: suite.key,
      label: suite.label,
      status: exec.code === 0 ? "PASS" : "FAIL",
      exit_code: exec.code,
      duration_ms: duration,
      total_pass: parsed.totalPass,
      total_fail: parsed.totalFail,
      total_skip: parsed.totalSkip,
      results: parsed.results,
    });
  }

  const totalPass = suiteResults.reduce((s, r) => s + r.total_pass, 0);
  const totalFail = suiteResults.reduce((s, r) => s + r.total_fail, 0);
  const totalSkip = suiteResults.reduce((s, r) => s + r.total_skip, 0);
  const overallStatus = totalFail > 0 ? "FAIL" : "PASS";

  const report = {
    report_type: "nightly_qa",
    started_at: startedAt,
    finished_at: nowIso(),
    overall_status: overallStatus,
    total_suites: suiteResults.length,
    suites_passed: suiteResults.filter((s) => s.status === "PASS").length,
    suites_failed: suiteResults.filter((s) => s.status === "FAIL").length,
    total_tests: totalPass + totalFail + totalSkip,
    total_pass: totalPass,
    total_fail: totalFail,
    total_skip: totalSkip,
    suites: suiteResults,
  };

  // Write report to test-results
  const outDir = path.join(ROOT, "test-results");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "nightly-qa-report.json"),
    JSON.stringify(report, null, 2)
  );

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n=== NIGHTLY QA REPORT ===\n");
    console.log(`Status:  ${overallStatus}`);
    console.log(`Started: ${report.started_at}`);
    console.log(`Finished: ${report.finished_at}`);
    console.log(`Tests:   ${report.total_tests} (✓ ${totalPass} | ✗ ${totalFail} | ↓ ${totalSkip})\n`);

    for (const suite of suiteResults) {
      const icon = suite.status === "PASS" ? "✅" : "❌";
      console.log(`${icon} ${suite.label} — ${suite.status} (${suite.duration_ms}ms)`);
      console.log(`   ✓ ${suite.total_pass} | ✗ ${suite.total_fail} | ↓ ${suite.total_skip}`);
    }

    console.log("");
  }

  if (CI_MODE && overallStatus === "FAIL") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Fatal QA report error:", err);
  process.exit(1);
});
