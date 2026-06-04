#!/usr/bin/env node
/**
 * Post-Cutover Smoke — runs the full active verify against the live domain
 * after DNS switch + SSL active.
 *
 * Usage: node scripts/seo/post-cutover-smoke.mjs
 */
import { spawnSync } from 'node:child_process';

const HOSTS = ['https://berufos.com', 'https://berufos.com'];
let allGreen = true;

for (const host of HOSTS) {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║ ${host.padEnd(40)} ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  const r = spawnSync('node', ['scripts/seo/active-shadow-verify.mjs'], {
    env: { ...process.env, HOST: host, SAMPLE: '5' },
    stdio: 'inherit',
  });
  if (r.status !== 0) allGreen = false;
}

// www → apex redirect check
console.log(`\n▶ www → apex redirect check`);
const r = await fetch('https://berufos.com/', { redirect: 'manual' });
const loc = r.headers.get('location') || '';
const ok301 = (r.status === 301 || r.status === 308) && /examfit\.de/.test(loc) && !/www\./.test(loc);
console.log(`  ${ok301 ? '✅' : '⚠️'} status=${r.status} location=${loc}`);

console.log(`\n══════════════════════════════════════════`);
console.log(allGreen ? '✅ POST-CUTOVER GREEN — Wave 3 freigegeben' : '❌ Drift erkannt — Wave 3 blockiert');
process.exit(allGreen ? 0 : 1);
