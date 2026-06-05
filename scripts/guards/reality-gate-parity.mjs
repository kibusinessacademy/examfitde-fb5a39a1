#!/usr/bin/env node
/**
 * Reality Gate Parity Guard
 *
 * Enforces structural equality of the early-fail gate steps and Authority-Host
 * default across all Reality-related workflows (Main Gate + Feeders).
 *
 * Fails CI when:
 *   - REALITY_BASE_URL default differs from the canonical authority host
 *   - Cold-Load Verify step is missing
 *   - Cold-Load Verify uses a different script path than the canonical one
 *   - Playwright install step is missing or differs
 *   - bun/checkout setup actions drift
 *
 * SSOT: src/lib/seo/authorityHost.ts (berufos.com).
 * Related: customer-reality-gate.yml, learner-reality-daily.yml,
 *          pre-customer-reality-daily.yml.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '.github/workflows');

const AUTHORITY_HOST = 'https://berufos.com';
const COLD_LOAD_SCRIPT = 'scripts/cold-load-verify.mjs';

const TARGETS = [
  '.github/workflows/customer-reality-gate.yml',
  '.github/workflows/learner-reality-daily.yml',
  '.github/workflows/pre-customer-reality-daily.yml',
];

const violations = [];

function check(file) {
  if (!fs.existsSync(file)) {
    violations.push(`[MISSING] ${file} does not exist`);
    return;
  }
  const src = fs.readFileSync(file, 'utf8');

  // 1. Authority host default
  const baseUrlMatch = src.match(/REALITY_BASE_URL:[^\n]*'(https?:\/\/[^']+)'/);
  if (!baseUrlMatch) {
    violations.push(`[${file}] REALITY_BASE_URL default not found`);
  } else if (baseUrlMatch[1] !== AUTHORITY_HOST) {
    violations.push(
      `[${file}] REALITY_BASE_URL default = "${baseUrlMatch[1]}", expected "${AUTHORITY_HOST}"`,
    );
  }

  // 2. Cold-Load Verify present + correct script
  if (!/Cold-Load Verify/i.test(src)) {
    violations.push(`[${file}] missing "Cold-Load Verify" early-fail step`);
  }
  if (!src.includes(`node ${COLD_LOAD_SCRIPT}`)) {
    violations.push(
      `[${file}] missing or wrong cold-load command (expected "node ${COLD_LOAD_SCRIPT}")`,
    );
  }

  // 3. Playwright install present
  if (!/playwright install --with-deps chromium/.test(src)) {
    violations.push(`[${file}] missing canonical "playwright install --with-deps chromium" step`);
  }

  // 4. bun + checkout pinned versions
  if (!/oven-sh\/setup-bun@v2/.test(src)) {
    violations.push(`[${file}] not using oven-sh/setup-bun@v2`);
  }
  if (!/actions\/checkout@v4/.test(src)) {
    violations.push(`[${file}] not using actions/checkout@v4`);
  }
}

for (const t of TARGETS) check(t);

// Summary
const header = '─── Reality Gate Parity Guard ───';
console.log(header);
console.log(`Targets:    ${TARGETS.length}`);
console.log(`Violations: ${violations.length}`);
if (violations.length) {
  console.log('');
  for (const v of violations) console.log('  ✗ ' + v);
  console.log('');
  console.log('FAIL — feeder workflows must mirror the Main Gate early-fail surface.');
  console.log('Fix: align the offending workflow with customer-reality-gate.yml.');
  process.exit(2);
}
console.log('PASS — all Reality workflows aligned.');
