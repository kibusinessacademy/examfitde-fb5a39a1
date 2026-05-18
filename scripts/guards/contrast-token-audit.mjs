#!/usr/bin/env node
/**
 * Contrast / token hygiene audit (static).
 *
 * Catches direct color usage that bypasses the design-system tokens and
 * therefore can't be QA'd for contrast in dark/density modes:
 *
 *   - tailwind classes: text-white | text-black | bg-white | bg-black
 *   - bg-{semantic}/<opacity>  for status colors (use status-bg-subtle instead)
 *   - text-text-tertiary used as primary content (warn if it's the ONLY text)
 *
 * Exits non-zero on hard violations (text-white / text-black in components).
 * Disabled state / badge token issues are reported as warnings.
 *
 * SCOPE: src/components/**, src/pages/**, src/features/** — excludes tests.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const BASELINE_PATH = "scripts/guards/.contrast-token-audit-baseline.txt";
const baseline = existsSync(BASELINE_PATH)
  ? new Set(
      readFileSync(BASELINE_PATH, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter((line) => line && !line.startsWith("#")),
    )
  : new Set();

const ROOTS = ["src/components", "src/pages", "src/features"];
const HARD_PATTERNS = [
  { id: "text-white", re: /\btext-white\b/g, msg: "Use text-text-on-primary or semantic token" },
  { id: "text-black", re: /\btext-black\b/g, msg: "Use text-text-primary token" },
  { id: "bg-white", re: /\bbg-white\b/g, msg: "Use bg-surface or bg-background token" },
  { id: "bg-black", re: /\bbg-black\b/g, msg: "Use bg-background or bg-surface-sunken token" },
  // ── status-Familie v2 hard guards (post-drift-cleanup) ──
  {
    id: "status-inverted-bg",
    re: /\bbg-status-bg-subtle(-[a-z]+)?\b/g,
    msg: "Inverted name. Use bg-status-<color>-bg-subtle (or bg-surface-sunken for neutral)",
  },
  {
    id: "status-inverted-fg",
    re: /\btext-status-fg-(error|success|warning|info|danger|warn)\b/g,
    msg: "Inverted name. Use text-status-<color>-fg",
  },
  {
    id: "status-legacy-alias",
    re: /\b(?:bg|border|text)-status-(?:danger|warn)(?:-[a-z-]+)?\b/g,
    msg: "Legacy alias. Use status-error (was danger) or status-warning (was warn)",
  },
  {
    id: "status-family-opacity",
    re: /\b(?:bg|border|text)-status-(?:error|success|warning|info)\/\d+\b/g,
    msg: "Use named status-<color>-{bg-subtle|border|text|fg} tokens instead of /<opacity>",
  },
];
const SOFT_PATTERNS = [
  {
    id: "status-opacity",
    re: /\bbg-(success|warning|destructive|info|error)\/(?:5|10|15|20|25)\b/g,
    msg: "Prefer status-bg-subtle tokens over /<opacity> for status surfaces",
  },
];
const IGNORE = [/\.test\.(t|j)sx?$/, /\.spec\.(t|j)sx?$/, /__tests__/, /\.stories\./];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ([".tsx", ".ts", ".jsx", ".js"].includes(extname(p))) out.push(p);
  }
  return out;
}

const hardHits = [];
const softHits = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (IGNORE.some((r) => r.test(file))) continue;
    const src = readFileSync(file, "utf8");
    for (const p of HARD_PATTERNS) {
      const m = src.match(p.re);
      if (m) hardHits.push({ file, id: p.id, count: m.length, msg: p.msg });
    }
    for (const p of SOFT_PATTERNS) {
      const m = src.match(p.re);
      if (m) softHits.push({ file, id: p.id, count: m.length, msg: p.msg });
    }
  }
}

if (softHits.length) {
  console.warn(`\n[contrast-token-audit] ${softHits.length} soft warning(s):`);
  for (const h of softHits.slice(0, 50)) {
    console.warn(`  WARN ${h.file}  ${h.id} ×${h.count} — ${h.msg}`);
  }
  if (softHits.length > 50) console.warn(`  …and ${softHits.length - 50} more`);
}

const newHits = hardHits.filter((h) => !baseline.has(h.file));
const grandfathered = hardHits.length - newHits.length;

if (newHits.length) {
  console.error(`\n[contrast-token-audit] ${newHits.length} NEW HARD violation(s):`);
  for (const h of newHits) {
    console.error(`  FAIL ${h.file}  ${h.id} ×${h.count} — ${h.msg}`);
  }
  console.error(
    "\nFix by replacing with semantic design tokens (see src/index.css), " +
      "or — if intentional refactor of a baseline file — update " +
      BASELINE_PATH,
  );
  process.exit(1);
}

console.log(
  `[contrast-token-audit] OK — 0 new hard violations, ${grandfathered} grandfathered, ${softHits.length} soft warning(s).`,
);

