#!/usr/bin/env node
/**
 * B2B Org Reality QA v1 — Server-smoke wrapper.
 *
 * Calls the b2b-org-reality-qa edge function with service-role and prints the
 * Reality Report + Gate decision (RELEASE / REVIEW / BLOCK).
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env:
 *   QA_SKIP_CLEANUP=true   -- leave fixtures behind for manual UI inspection
 *   QA_CLEANUP_ONLY=true   -- only wipe fixtures, do not run probes
 *
 * Exit 0 = RELEASE or REVIEW, Exit 1 = BLOCK (or transport error).
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const body = {
  cleanup_only: process.env.QA_CLEANUP_ONLY === 'true',
  skip_cleanup: process.env.QA_SKIP_CLEANUP === 'true',
};

async function main() {
  console.log('\n=== B2B Org Reality QA v1 ===');
  console.log(`mode: ${body.cleanup_only ? 'cleanup_only' : 'full_probe'}`);
  console.log(`skip_cleanup: ${body.skip_cleanup}\n`);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/b2b-org-reality-qa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (body.cleanup_only) {
    console.log(json);
    process.exit(res.ok ? 0 : 1);
  }

  const findings = json.findings || [];
  console.log(`Gate: ${json.gate || '(unknown)'}`);
  console.log(`Summary: ${JSON.stringify(json.summary || {})}\n`);
  console.log('Findings:');
  for (const f of findings) {
    const icon = f.status === 'pass' ? '✓'
               : f.status === 'fail' ? '✗'
               : '·';
    const sev = f.severity === 'critical' ? '[CRIT]' : '[ux]  ';
    console.log(`  ${icon} ${sev} ${f.code}${f.detail ? ` — ${f.detail}` : ''}`);
  }

  if (!json.gate) {
    console.error('\nNo gate decision returned:', json);
    process.exit(1);
  }

  if (json.gate === 'BLOCK') {
    console.error('\n[BLOCK] critical reality failures — fix before release.');
    process.exit(1);
  }
  if (json.gate === 'REVIEW') {
    console.warn('\n[REVIEW] ux-level findings — eyeball before release.');
    process.exit(0);
  }
  console.log('\n[RELEASE] all reality checks green.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[reality-qa] fatal', err);
  process.exit(1);
});
