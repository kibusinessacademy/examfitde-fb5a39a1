#!/usr/bin/env node
/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Guard: keine Hex-Farben in `examfit-ds/**`.
 * Tokens-only. Erlaubt nur HSL via CSS-Variablen (var(--…)) und Tailwind-Utilities.
 *
 * Lauf: `node scripts/guard-no-raw-hex.mjs`
 * CI-tauglich (Exit 1 on Findings).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = 'src/components/examfit-ds';
const EXTS = new Set(['.ts', '.tsx', '.css']);
const HEX = /#([0-9a-fA-F]{3,8})\b/g;

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (EXTS.has(extname(p))) scan(p);
  }
}

function scan(file) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    let m;
    while ((m = HEX.exec(line)) !== null) {
      findings.push({ file, line: i + 1, value: m[0], excerpt: line.trim().slice(0, 140) });
    }
  });
}

try {
  walk(ROOT);
} catch (e) {
  if (e?.code === 'ENOENT') {
    console.log(`[guard] ${ROOT} not present — skipping.`);
    process.exit(0);
  }
  throw e;
}

if (findings.length > 0) {
  console.error(`\n❌ EXAMFIT.DESIGN.SYSTEM.OS.1 guard: raw hex colors are forbidden in ${ROOT}.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.value}   ${f.excerpt}`);
  }
  console.error(`\nUse design tokens (HSL via var(--…)) or Tailwind utilities instead.\n`);
  process.exit(1);
}

console.log(`✅ EXAMFIT.DESIGN.SYSTEM.OS.1 guard passed — no raw hex in ${ROOT}.`);
