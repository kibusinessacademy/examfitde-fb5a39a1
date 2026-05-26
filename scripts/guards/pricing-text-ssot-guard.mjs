#!/usr/bin/env node
/**
 * Pricing-Text-SSOT-Guard
 * Hard-fail wenn Marketing/SEO/Public-Code hartcodierte Preise ausgibt,
 * die nicht dem B2C-Pricing-SSOT (24,90 € / 12 Monate, Bundle-only) entsprechen.
 *
 * SSOT: src/config/pricing.ts (PRICING.defaultPrice, PRICING_CATEGORIES, B2B-Tiers).
 * Verboten in Public-Pfaden:
 *   - "149 €" / "199 €" / "249 €" / "299 €" als ganze Token
 *   - "ab 149" / "ab 199" / "ab 249" / "ab 299"
 *
 * Erlaubt:
 *   - Pfad enthält "/admin/", "/__tests__/", ".test.", ".spec.", "/test/", "/migrations/", "/legacy/"
 *   - Datei ist diese Guard-Datei selbst
 *   - Datei ist src/config/pricing.ts (SSOT)
 *   - Datei ist eine Memory-/Doc-Datei (.md)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/pages', 'src/components'];
const SKIP_PATH_FRAGMENTS = [
  '/admin/',
  '/__tests__/',
  '/test/',
  '/migrations/',
  '/legacy/',
  '.test.',
  '.spec.',
  '.md',
  '.mdx',
];
const SKIP_EXACT = new Set([
  'src/config/pricing.ts',
  'scripts/guards/pricing-text-ssot-guard.mjs',
]);

// Forbidden literals — exact substrings (case-insensitive).
// Scope: B2C-EXAM_FIRST-Pricing-Drift. B2B-Standalone-License-Plans (99/299/799 €
// in /berufski/corporate, /work/corporate) sind separater SKU-Set und NICHT betroffen.
const FORBIDDEN = [
  '149 €',
  '199 €',
  'ab 149',
  'ab 199',
];


function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full);
  }
  return files;
}

function shouldSkip(relPath) {
  if (SKIP_EXACT.has(relPath)) return true;
  return SKIP_PATH_FRAGMENTS.some((f) => relPath.includes(f));
}

const violations = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    if (shouldSkip(rel)) continue;
    const content = readFileSync(file, 'utf8');
    const lower = content.toLowerCase();
    for (const needle of FORBIDDEN) {
      const n = needle.toLowerCase();
      let idx = 0;
      while ((idx = lower.indexOf(n, idx)) !== -1) {
        const lineNum = content.slice(0, idx).split('\n').length;
        const lineText = content.split('\n')[lineNum - 1].trim();
        violations.push({ file: rel, line: lineNum, needle, snippet: lineText.slice(0, 160) });
        idx += n.length;
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✓ pricing-text-ssot-guard: 0 violations (B2C-SSOT 24,90 € respected).');
  process.exit(0);
}

console.error(`✗ pricing-text-ssot-guard: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  "${v.needle}"  →  ${v.snippet}`);
}
console.error(`\nSSOT: PRICING.defaultPrice (= "24,90 €") in src/config/pricing.ts`);
console.error(`Fix: Importiere PRICING und nutze PRICING.defaultPrice / PRICING.defaultAccess.`);
process.exit(1);
