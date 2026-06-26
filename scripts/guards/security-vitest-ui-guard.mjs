#!/usr/bin/env node
/**
 * SECURITY.DEPENDENCY.HARDENING.P0 guard
 *
 * Blocks regressions of the three mitigations baked into our P0
 * dependency-hardening cut:
 *
 *  1. Vitest UI server MUST NOT be referenced from any committed script,
 *     workflow or env file. The Vitest UI is the surface of the Critical
 *     "arbitrary file read/execution" advisory (GHSA-9crc-q9x8-hgqq).
 *  2. The `@vitest/ui` package MUST NOT appear in package.json
 *     (dependencies, devDependencies, optionalDependencies).
 *  3. Dev/preview servers MUST NOT be exposed on 0.0.0.0 from scripts
 *     (vite/vitest dev/preview/--host 0.0.0.0).
 *  4. NEW: Preview/Production build & deploy artifacts MUST be free of
 *     vitest --ui / @vitest/ui references — the Vitest UI must never
 *     ship in a deploy pipeline (zero exposure beyond local dev).
 *
 * Run via: node scripts/guards/security-vitest-ui-guard.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// General code surfaces (workflows, scripts, tests).
const SCAN_DIRS = [".github/workflows", "scripts", "tests"];
const SCAN_FILES = ["package.json", "vite.config.ts", "vitest.config.ts"];

// ---------------------------------------------------------------------------
// NEW: Preview/Production build & deployment surfaces.
// Anything that influences what gets bundled, served, deployed, or executed
// by Vercel/Cloudflare/Capacitor/Netlify must be screened with zero tolerance.
// ---------------------------------------------------------------------------
const DEPLOY_FILES = [
  "vercel.json",
  "netlify.toml",
  "wrangler.toml",
  "cloudflare.toml",
  "capacitor.config.ts",
  "capacitor.config.json",
  "public/_headers",
  "public/_redirects",
  "Dockerfile",
  "Dockerfile.prod",
  "docker-compose.yml",
  "docker-compose.prod.yml",
  ".lovable/deploy.json",
];

// Workflows whose *purpose* is build / preview / deploy. We treat any vitest-UI
// reference inside these as a hard P0 violation regardless of pattern context.
const DEPLOY_WORKFLOW_HINTS = [
  /deploy/i,
  /preview/i,
  /vercel/i,
  /cloudflare/i,
  /netlify/i,
  /capacitor/i,
  /publish/i,
  /production/i,
  /release/i,
  /build/i,
];

const FORBIDDEN_PATTERNS = [
  { re: /vitest\s+(?:[^\n]*\s)?--ui\b/, msg: "Vitest UI flag (--ui) detected" },
  { re: /@vitest\/ui/, msg: "@vitest/ui package reference detected" },
  {
    re: /(?:vite|vitest)[^\n]*--host[^\n]*0\.0\.0\.0/,
    msg: "Dev/preview server bound to 0.0.0.0",
  },
];

// Stricter pattern set for deploy artifacts — only the UI surface matters here,
// but ANY hit is treated as deploy-pipeline contamination.
const DEPLOY_FORBIDDEN_PATTERNS = [
  { re: /vitest\s+(?:[^\n]*\s)?--ui\b/, msg: "Vitest UI flag (--ui) in deploy artifact" },
  { re: /@vitest\/ui/, msg: "@vitest/ui referenced from deploy artifact" },
  { re: /\bvitest\b[^\n]*\bpreview\b/, msg: "Vitest invoked from deploy/preview pipeline" },
];

const violations = [];
const SELF = new URL(import.meta.url).pathname;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p);
    else if (s.isFile() && /\.(json|ya?ml|mjs|cjs|js|ts|tsx|sh|toml)$/.test(e)) {
      scan(p, FORBIDDEN_PATTERNS, "code");
    }
  }
}

function scan(path, patterns, kind) {
  if (path === SELF) return;
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const { re, msg } of patterns) {
    const m = text.match(re);
    if (m) {
      violations.push({
        path: relative(ROOT, path),
        msg,
        kind,
        snippet: m[0].slice(0, 120),
      });
    }
  }
}

// 1) Scan general code surfaces.
for (const d of SCAN_DIRS) walk(join(ROOT, d));
for (const f of SCAN_FILES) scan(join(ROOT, f), FORBIDDEN_PATTERNS, "code");

// 2) Scan deploy-config artifacts with stricter pattern set.
for (const f of DEPLOY_FILES) {
  const full = join(ROOT, f);
  if (existsSync(full)) scan(full, DEPLOY_FORBIDDEN_PATTERNS, "deploy-config");
}

// 3) Re-scan deploy/build/preview workflows with the strict deploy patterns.
//    (They were already scanned as "code"; here we add the stricter screen so
//    even subtle references like `vitest preview` are caught in pipelines.)
try {
  const wfDir = join(ROOT, ".github/workflows");
  for (const e of readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(e)) continue;
    if (!DEPLOY_WORKFLOW_HINTS.some((re) => re.test(e))) continue;
    scan(join(wfDir, e), DEPLOY_FORBIDDEN_PATTERNS, "deploy-workflow");
  }
} catch { /* no workflows dir */ }

// 4) Structural checks on package.json.
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  // 4a) @vitest/ui must not appear anywhere in dependency fields.
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (pkg[field]?.["@vitest/ui"]) {
      violations.push({
        path: "package.json",
        kind: "deploy-config",
        msg: `@vitest/ui declared in ${field}`,
        snippet: `${field}["@vitest/ui"] = ${pkg[field]["@vitest/ui"]}`,
      });
    }
  }

  // 4b) `scripts` entries that look like build/preview/deploy must not chain
  //     vitest --ui / @vitest/ui, even indirectly (npm-run-all, &&, ;, |).
  const scripts = pkg.scripts ?? {};
  const DEPLOYISH_SCRIPT = /^(build|preview|deploy|release|publish|start|prod|prebuild|postbuild|predeploy|postdeploy)/i;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (typeof cmd !== "string") continue;
    if (!DEPLOYISH_SCRIPT.test(name)) continue;
    for (const { re, msg } of DEPLOY_FORBIDDEN_PATTERNS) {
      if (re.test(cmd)) {
        violations.push({
          path: "package.json#scripts",
          kind: "deploy-config",
          msg: `${msg} in script "${name}"`,
          snippet: cmd.slice(0, 160),
        });
      }
    }
  }
} catch (err) {
  console.error("::warning::Could not parse package.json:", err.message);
}

if (violations.length > 0) {
  console.error("\n::error::SECURITY.DEPENDENCY.HARDENING.P0 guard FAILED");
  console.error("The following forbidden patterns were detected:");
  const grouped = violations.reduce((acc, v) => {
    (acc[v.kind] ??= []).push(v);
    return acc;
  }, /** @type {Record<string, typeof violations>} */ ({}));
  for (const [kind, list] of Object.entries(grouped)) {
    console.error(`\n  [${kind}] ${list.length} finding(s):`);
    for (const v of list) {
      console.error(`    - ${v.path} — ${v.msg}`);
      console.error(`        ${v.snippet}`);
    }
  }
  console.error(
    "\nRationale: Vitest UI / open dev-server bindings are the attack surface " +
      "of GHSA-9crc-q9x8-hgqq (Critical). The UI must never appear in any " +
      "preview/production build or deploy pipeline — remove the offending reference."
  );
  process.exit(1);
}

const deployScanned = DEPLOY_FILES.filter((f) => existsSync(join(ROOT, f)));
console.log(
  `✓ security-vitest-ui-guard OK — scanned ${SCAN_DIRS.join(", ")} + ` +
    `${SCAN_FILES.length} root files + ${deployScanned.length} deploy artifact(s) ` +
    `(${deployScanned.join(", ") || "none present"}) + deploy/build/preview workflows + ` +
    `package.json scripts. No forbidden patterns.`
);
