#!/usr/bin/env node
/**
 * build-workflow-index.mjs
 * ────────────────────────
 * Scannt `.github/workflows/*.yml` und erzeugt
 * `docs/security/workflow-index.json` für die UI-Verknüpfung von Findings.
 *
 * Misst pro Workflow:
 *   - hasTopLevelPermissions (vermeidet `permissions: write-all` Default)
 *   - unpinnedActionsTotal (uses: …@vN ohne SHA)
 *   - jobs[].hasTimeout (timeout-minutes vorhanden)
 *
 * Re-Run: `node scripts/security/build-workflow-index.mjs`
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");
const OUT = path.join(ROOT, "docs", "security", "workflow-index.json");

const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f));

const RE_TOP_PERMS = /^permissions:/m;
const RE_USES_UNPINNED = /uses:\s+[\w.-]+\/[\w.-]+@v\d+\s*$/gm;
const RE_JOB_HEADER = /^ {2}([a-zA-Z0-9_-]+):\s*$/gm;
const RE_TIMEOUT = /timeout-minutes:/;

const workflows = files.map((file) => {
  const src = fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
  const hasTopLevelPermissions = RE_TOP_PERMS.test(src);
  const unpinnedActionsTotal = (src.match(RE_USES_UNPINNED) || []).length;

  // Job-Block-Extraktion (heuristisch): zwischen Job-Headern auf 2-Space-Einzug.
  const jobs = [];
  const lines = src.split("\n");
  let inJobs = false;
  let currentName = null;
  let currentBlock = [];
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const m = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (m) {
      if (currentName) {
        jobs.push({
          name: currentName,
          hasTimeout: RE_TIMEOUT.test(currentBlock.join("\n")),
          unpinnedSteps: (currentBlock.join("\n").match(RE_USES_UNPINNED) || []).length,
        });
      }
      currentName = m[1];
      currentBlock = [];
    } else if (/^\S/.test(line)) {
      // top-level key beendet jobs:
      break;
    } else if (currentName) {
      currentBlock.push(line);
    }
  }
  if (currentName) {
    jobs.push({
      name: currentName,
      hasTimeout: RE_TIMEOUT.test(currentBlock.join("\n")),
      unpinnedSteps: (currentBlock.join("\n").match(RE_USES_UNPINNED) || []).length,
    });
  }

  return { file, hasTopLevelPermissions, jobs, unpinnedActionsTotal };
});

const out = {
  generated_at: new Date().toISOString(),
  workflows,
  summary: {
    total: workflows.length,
    missingPermissions: workflows.filter((w) => !w.hasTopLevelPermissions).length,
    unpinnedActions: workflows.reduce((s, w) => s + w.unpinnedActionsTotal, 0),
    jobsWithoutTimeout: workflows.reduce(
      (s, w) => s + w.jobs.filter((j) => !j.hasTimeout).length,
      0,
    ),
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`✓ workflow-index.json geschrieben: ${OUT}`);
console.log(JSON.stringify(out.summary, null, 2));
