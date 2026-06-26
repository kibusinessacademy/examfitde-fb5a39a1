#!/usr/bin/env node
/**
 * Price-Display-Format-Guard
 *
 * Hart-fail wenn UI-Code rohe numerische Preise direkt mit "€" interpoliert
 * (führt zu "24.9 €" statt "24,90 €").
 *
 * SSOT:
 *  - UI:    src/lib/priceFormat.ts  → formatEuro() / formatEuroCents()
 *  - SEO:   src/lib/seo.ts          → PRODUCT_PRICES (numeric, NUR für JSON-LD)
 *
 * Verboten in src/pages|src/components (außer /admin/, tests, .md):
 *  - "${PRODUCT_PRICES.<key>} €"
 *  - "{PRODUCT_PRICES.<key>} €"
 *  - hartcodierte "24.9 €" / "24.90 €"
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/pages', 'src/components'];
const SKIP = ['/admin/', '/__tests__/', '/test/', '.test.', '.spec.', '.md'];

const PATTERNS = [
  { re: /\$\{\s*PRODUCT_PRICES\.[a-zA-Z_]+\s*\}\s*€/g, hint: 'Use PRODUCT_PRICE_DISPLAY or formatEuro()' },
  { re: /\{\s*PRODUCT_PRICES\.[a-zA-Z_]+\s*\}\s*€/g, hint: 'Use {PRODUCT_PRICE_DISPLAY} or {formatEuro(...)}' },
  { re: /\b24\.90?\s*€/g, hint: 'Hardcoded "24.9 €" — use formatEuro(24.9) or PRODUCT_PRICE_DISPLAY' },
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    const s = statSync(f);
    if (s.isDirectory()) walk(f, out);
    else if (/\.(tsx?|jsx?)$/.test(e)) out.push(f);
  }
  return out;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  try { statSync(join(ROOT, dir)); } catch { continue; }
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (SKIP.some((s) => rel.includes(s))) continue;
    const content = readFileSync(file, 'utf8');
    for (const { re, hint } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const line = content.slice(0, m.index).split('\n').length;
        violations.push({ file: rel, line, match: m[0], hint });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✓ price-display-format-guard: 0 violations.');
  process.exit(0);
}
console.error(`✗ price-display-format-guard: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  "${v.match}"  →  ${v.hint}`);
}
console.error(`\nSSOT: src/lib/priceFormat.ts (formatEuro) — UI immer "24,90 €", JSON-LD numerisch.`);
process.exit(1);
