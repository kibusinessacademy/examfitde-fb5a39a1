#!/usr/bin/env node
/**
 * Master Platform Audit
 *
 * Orchestrates three sub-audits and delivers a single GO / NO_GO verdict:
 * 1. Platform E2E Audit
 * 2. Deep Data Integrity Audit
 * 3. Pipeline Change Audit
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const JSON_OUT = process.argv.includes("--json");
const FULL = process.argv.includes("--full");
const FAIL_ON_WARN = process.argv.includes("--fail-on-warn");
const PACKAGE_ID_ARG = process.argv.find(a => a.startsWith("--package="));
const PACKAGE_ID = PACKAGE_ID_ARG ? PACKAGE_ID_ARG.split("=")[1] : null;

const ROOT = process.cwd();

const TASKS = [
  {
    key: "platform_e2e",
    label: "Platform E2E Audit",
    file: path.join(ROOT, "scripts", "e2e-platform-audit.mjs"),
    args: FULL ? ["--full", "--json"] : ["--json"],
    critical: true,
  },
  {
    key: "deep_data_integrity",
    label: "Deep Data Integrity Audit",
    file: path.join(ROOT, "scripts", "deep-data-integrity-audit.mjs"),
    args: ["--json"],
    critical: true,
  },
  {
    key: "pipeline_change",
    label: "Pipeline Change Audit",
    file: path.join(ROOT, "scripts", "pipeline-change-audit.mjs"),
    args: [
      ...(PACKAGE_ID ? [`--package=${PACKAGE_ID}`] : []),
      "--json",
    ],
    critical: true,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function runNodeScript(file, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      env: process.env,
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = null; }
      resolve({ code: code ?? 1, stdout, stderr, parsed });
    });
  });
}

function normalizeTaskResult(task, execution) {
  const parsed = execution.parsed || {};
  const passCount = Number(parsed.pass_count || 0);
  const warnCount = Number(parsed.warn_count || 0);
  const failCount = Number(parsed.fail_count || 0);

  const status =
    failCount > 0 || execution.code !== 0
      ? "FAIL"
      : warnCount > 0
      ? "WARN"
      : "PASS";

  return {
    task_key: task.key,
    label: task.label,
    critical: task.critical,
    status,
    exit_code: execution.code,
    pass_count: passCount,
    warn_count: warnCount,
    fail_count: failCount,
    failures: parsed.failures || [],
    warnings: parsed.warnings || [],
    results: parsed.results || [],
    stderr: execution.stderr || "",
  };
}

function computeVerdict(taskResults) {
  const criticalFails = taskResults.filter(t => t.critical && t.status === "FAIL").length;
  const anyFails = taskResults.filter(t => t.status === "FAIL").length;
  const anyWarns = taskResults.filter(t => t.status === "WARN").length;

  if (criticalFails > 0 || anyFails > 0) return "NO_GO";
  if (anyWarns > 0) return "GO_WITH_WARNINGS";
  return "GO";
}

function printHumanSummary(summary) {
  console.log("\n=== MASTER PLATFORM AUDIT ===\n");
  console.log(`Started:  ${summary.started_at}`);
  console.log(`Finished: ${summary.finished_at}`);
  console.log(`Verdict:  ${summary.verdict}\n`);

  for (const task of summary.tasks) {
    const icon = task.status === "PASS" ? "✅" : task.status === "WARN" ? "⚠️" : "❌";
    console.log(
      `${icon} ${task.label} — ${task.status} ` +
      `(pass=${task.pass_count}, warn=${task.warn_count}, fail=${task.fail_count})`
    );

    if (task.status !== "PASS") {
      const important = [
        ...(task.failures || []).map(x => ({ kind: "FAIL", ...x })),
        ...(task.warnings || []).map(x => ({ kind: "WARN", ...x })),
      ].slice(0, 10);

      for (const item of important) {
        console.log(`   • [${item.kind}] ${item.key}: ${item.message}`);
      }
    }
  }

  console.log("\n--- Totals ---");
  console.log(`Tasks PASS: ${summary.task_pass_count}`);
  console.log(`Tasks WARN: ${summary.task_warn_count}`);
  console.log(`Tasks FAIL: ${summary.task_fail_count}`);
  console.log(`Global PASS: ${summary.global_pass_count}`);
  console.log(`Global WARN: ${summary.global_warn_count}`);
  console.log(`Global FAIL: ${summary.global_fail_count}`);
}

async function main() {
  const startedAt = nowIso();
  const taskResults = [];

  for (const task of TASKS) {
    const execution = await runNodeScript(task.file, task.args);
    taskResults.push(normalizeTaskResult(task, execution));
  }

  const verdict = computeVerdict(taskResults);

  const summary = {
    started_at: startedAt,
    finished_at: nowIso(),
    profile: FULL ? "full" : "safe",
    package_id: PACKAGE_ID,
    verdict,
    task_pass_count: taskResults.filter(t => t.status === "PASS").length,
    task_warn_count: taskResults.filter(t => t.status === "WARN").length,
    task_fail_count: taskResults.filter(t => t.status === "FAIL").length,
    global_pass_count: taskResults.reduce((s, t) => s + t.pass_count, 0),
    global_warn_count: taskResults.reduce((s, t) => s + t.warn_count, 0),
    global_fail_count: taskResults.reduce((s, t) => s + t.fail_count, 0),
    tasks: taskResults,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanSummary(summary);
  }

  if (verdict === "NO_GO") process.exit(1);
  if (FAIL_ON_WARN && verdict === "GO_WITH_WARNINGS") process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal master audit error:", err);
  process.exit(1);
});
