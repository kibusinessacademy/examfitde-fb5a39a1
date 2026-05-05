#!/usr/bin/env node
/**
 * Apply branch-protection rules on `main` so the required-checks list
 * matches `docs/pr-governance.md`.
 *
 * Required environment:
 *   GITHUB_TOKEN  — PAT with `repo` scope (admin on the repo)
 *   GITHUB_REPO   — owner/repo, e.g. "examfit/app"
 *   BRANCH        — optional, defaults to "main"
 *
 * Usage:
 *   GITHUB_TOKEN=… GITHUB_REPO=org/app node scripts/governance/apply-branch-protection.mjs
 *   GITHUB_TOKEN=… GITHUB_REPO=org/app node scripts/governance/apply-branch-protection.mjs --dry-run
 *
 * The required-checks list is parsed straight from docs/pr-governance.md
 * (the "Required" markdown table, column "Workflow") — single source of truth.
 */
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPO;
const branch = process.env.BRANCH || "main";

if (!token || !repo) {
  console.error(
    "FAIL: GITHUB_TOKEN and GITHUB_REPO are required (e.g. GITHUB_REPO=org/app).",
  );
  process.exit(2);
}

// ── 1. Parse required check names from docs/pr-governance.md ─────────────
const md = readFileSync("docs/pr-governance.md", "utf8");
const requiredSection = md.split(/^## /m).find((s) => s.startsWith("Required"));
if (!requiredSection) {
  console.error("FAIL: docs/pr-governance.md is missing the '## Required' section.");
  process.exit(2);
}
const checks = [];
for (const line of requiredSection.split("\n")) {
  // table rows look like: | `workflow-name` | … | … |
  const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
  if (!m) continue;
  if (m[1].toLowerCase() === "workflow") continue; // header
  checks.push(m[1]);
}
if (checks.length === 0) {
  console.error("FAIL: no required checks parsed from docs/pr-governance.md.");
  process.exit(2);
}

console.log(`[branch-protection] ${repo}@${branch} — required checks:`);
for (const c of checks) console.log(`  - ${c}`);

if (DRY) {
  console.log("\n[branch-protection] --dry-run: not calling GitHub API.");
  process.exit(0);
}

// ── 2. PUT /repos/{owner}/{repo}/branches/{branch}/protection ────────────
const url = `https://api.github.com/repos/${repo}/branches/${branch}/protection`;
const body = {
  required_status_checks: {
    strict: true,
    contexts: checks,
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
  },
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
};

const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error(`\n[branch-protection] FAIL (${res.status}):\n${text}`);
  process.exit(1);
}
console.log(`\n[branch-protection] OK — ${checks.length} required checks applied to ${branch}.`);
