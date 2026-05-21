#!/usr/bin/env node
/**
 * P6 Cut 2 — Internal Link Hygiene Guard
 *
 * Verhindert neue interne Links auf Routen, die in AppRoutes.tsx als
 * Legacy-301 oder noindex behandelt werden. Crawler folgen Internal-
 * Links auch nach Redirects — saubere Quell-Hrefs sind die einzige
 * dauerhafte Lösung.
 *
 * Scannt src/ nach `to="/<dead>"` / `href="/<dead>"` Pattern.
 * Allowlist: AppRoutes.tsx (Redirect-Deklarationen), RouteNoindex.tsx
 * (noindex-Patterns), LegacyParamRedirect.tsx (Doku), Tests, dieser Guard.
 *
 * Exit 1 bei Treffern → CI-Fail.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Forbidden-Targets als Literal-Strings in to=/href= Attributen.
// Jede Regex matched die ZIEL-URL inkl. öffnendem Quote.
const FORBIDDEN = [
  { key: 'products', re: /(?:to|href)=["']\/products(?:["'/?#])/ },
  { key: 'product/<slug>', re: /(?:to|href)=["']\/product\// },
  { key: 'category/<slug>', re: /(?:to|href)=["']\/category\// },
  { key: 'learning/*', re: /(?:to|href)=["']\/learning\// },
  { key: 'checkout', re: /(?:to|href)=["']\/checkout(?:["'/?#])/ },
  { key: 'search', re: /(?:to|href)=["']\/search(?:["'/?#])/ },
  { key: 'legal/*', re: /(?:to|href)=["']\/legal\// },
];

const ALLOWLIST = new Set([
  'src/routes/AppRoutes.tsx',
  'src/components/seo/RouteNoindex.tsx',
  'src/components/seo/LegacyParamRedirect.tsx',
  'scripts/guards/internal-link-hygiene-guard.mjs',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'src'));
const violations = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (ALLOWLIST.has(rel)) continue;
  if (rel.includes('__tests__') || rel.includes('/test/')) continue;

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const f of FORBIDDEN) {
      if (f.re.test(line)) {
        violations.push({ file: rel, line: i + 1, target: f.key, code: line.trim().slice(0, 160) });
      }
    }
  });
}

console.log(`\n=== Internal Link Hygiene Guard ===`);
console.log(`Scanned files : ${files.length}`);
console.log(`Forbidden     : ${FORBIDDEN.map((f) => f.key).join(', ')}`);
console.log(`Violations    : ${violations.length}\n`);

if (violations.length) {
  for (const v of violations) {
    console.log(`  ✗ ${v.file}:${v.line} → ${v.target}`);
    console.log(`      ${v.code}`);
  }
  console.log(`\nFix: Repointe Link auf die SEO-/Conversion-Zielroute (z.B. /paket, /wissen, /agb).`);
  console.log(`Redirects in AppRoutes.tsx fangen Restcrawls ab — interne Links MÜSSEN sauber sein.`);
  process.exit(1);
}

console.log(`✅ Keine internen Links auf legacy-/redirected Routen.`);
