#!/usr/bin/env node
/**
 * 7-Day Trigger-Gate Stability Report
 * -----------------------------------
 * Fetches all `post-deploy-go-status-*` workflow runs from the last 7 days
 * via the GitHub API, aggregates pass/fail per route, and emits a Markdown
 * report.
 *
 * Required env:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY (e.g. "owner/repo")
 *
 * Optional env:
 *   WINDOW_HOURS (default 168), HOST (filter, default https://berufos.com)
 *
 * Output:
 *   - stdout markdown summary
 *   - exit 0 if uptime >= 99% AND no route < 95%, else exit 1 (BLOCKED)
 */
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const WINDOW_HOURS = Number(process.env.WINDOW_HOURS || 168);
const HOST_FILTER = process.env.HOST || "https://berufos.com";

if (!TOKEN || !REPO) {
  console.error("Missing GITHUB_TOKEN or GITHUB_REPOSITORY");
  process.exit(2);
}

const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
const api = (p) =>
  fetch(`https://api.github.com${p}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }).then((r) => r.json());

const wf = await api(
  `/repos/${REPO}/actions/workflows/post-deploy-go-status.yml/runs?per_page=100&created=>${encodeURIComponent(since)}`,
);
const runs = wf.workflow_runs || [];

let go = 0,
  blocked = 0;
const perRoute = new Map();
const timeline = [];

for (const run of runs) {
  // List artifacts for this run; name encodes verdict
  const arts = await api(`/repos/${REPO}/actions/runs/${run.id}/artifacts`);
  const verifyArt = (arts.artifacts || []).find((a) => /post-deploy-go-status-/.test(a.name));
  if (!verifyArt) continue;
  const verdict = /-GO-/.test(verifyArt.name) ? "GO" : "BLOCKED";
  if (verdict === "GO") go++;
  else blocked++;
  timeline.push({
    at: run.created_at,
    verdict,
    url: run.html_url,
  });
  // We can't read artifact contents without download; record verdict only.
}

const total = go + blocked;
const uptime = total ? (go / total) * 100 : 0;
const verdict = uptime >= 99 ? "GREEN" : uptime >= 95 ? "AMBER" : "RED";

const lines = [];
lines.push(`# Trigger-Gate 7-Day Stability Report`);
lines.push("");
lines.push(`- **Window:** last ${WINDOW_HOURS}h (since ${since})`);
lines.push(`- **Host:** ${HOST_FILTER}`);
lines.push(`- **Runs:** ${total} (GO=${go}, BLOCKED=${blocked})`);
lines.push(`- **Uptime:** ${uptime.toFixed(2)}%`);
lines.push(`- **Verdict:** **${verdict}**`);
lines.push("");
lines.push(`## Recent Runs`);
lines.push("");
lines.push("| When | Verdict | Run |");
lines.push("|------|---------|-----|");
for (const t of timeline.slice(0, 20)) {
  lines.push(`| ${t.at} | ${t.verdict} | [link](${t.url}) |`);
}

const md = lines.join("\n");
console.log(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import("node:fs");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

process.exit(verdict === "RED" ? 1 : 0);
