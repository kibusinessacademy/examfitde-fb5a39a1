#!/usr/bin/env node
/**
 * Dispatch the Soft-Launch-Gate workflow against the correct Lovable repo.
 *
 * Resolves the target repo from (in order):
 *   1. CLI arg:  node soft-launch-gate-dispatch.mjs owner/repo
 *   2. env GITHUB_TARGET_REPO=owner/repo
 *   3. env GITHUB_OWNER + GITHUB_REPO
 *
 * On 404 prints a clear message: token has no scope on the target repo.
 * Exits 0 on dispatch success, 1 on auth/scope errors, 2 on transport errors.
 */
const TOKEN = process.env.GITHUB_E2E_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("❌ Missing GITHUB_E2E_TOKEN / GH_TOKEN. Provide a PAT with `repo` + `workflow` scope on the Lovable repo.");
  process.exit(1);
}

const cliRepo = process.argv[2];
const envRepo = process.env.GITHUB_TARGET_REPO;
const owner = process.env.GITHUB_OWNER;
const repoName = process.env.GITHUB_REPO;
const target = cliRepo || envRepo || (owner && repoName ? `${owner}/${repoName}` : null);

if (!target || !target.includes("/")) {
  console.error("❌ No target repo. Pass `owner/repo` as arg or set GITHUB_TARGET_REPO.");
  process.exit(1);
}

const baseUrl = process.env.SOFT_LAUNCH_BASE_URL || "https://examfitde.lovable.app";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

// Step 1: confirm scope by HEAD on the workflow file.
const wfRes = await fetch(
  `https://api.github.com/repos/${target}/actions/workflows/soft-launch-gate.yml`,
  { headers },
);
if (wfRes.status === 404) {
  const me = await fetch("https://api.github.com/user", { headers }).then((r) => r.json()).catch(() => ({}));
  console.error(`❌ 404 — token (user: ${me.login ?? "?"}) has no access to ${target} OR the workflow file does not exist on the default branch.`);
  console.error("   Fixes:");
  console.error("   • Verify owner/repo is correct (case-sensitive).");
  console.error("   • Use a PAT created by a user with push access to the Lovable repo.");
  console.error("   • Ensure PAT scopes include `repo` AND `workflow`.");
  console.error("   • Confirm soft-launch-gate.yml is committed on the default branch.");
  process.exit(1);
}
if (wfRes.status === 401 || wfRes.status === 403) {
  console.error(`❌ ${wfRes.status} — token rejected. Check expiry and scopes (`repo` + `workflow`).`);
  process.exit(1);
}
if (!wfRes.ok) {
  console.error(`❌ Workflow lookup failed: ${wfRes.status} ${await wfRes.text()}`);
  process.exit(2);
}

// Step 2: dispatch.
const dispatchRes = await fetch(
  `https://api.github.com/repos/${target}/dispatches`,
  {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: "soft_launch_gate",
      client_payload: { base_url: baseUrl },
    }),
  },
);
if (dispatchRes.status === 204) {
  console.log(`✅ Dispatched soft_launch_gate to ${target} (base_url=${baseUrl})`);
  console.log(`   Watch: https://github.com/${target}/actions/workflows/soft-launch-gate.yml`);
  process.exit(0);
}
console.error(`❌ Dispatch failed: ${dispatchRes.status} ${await dispatchRes.text()}`);
process.exit(2);
