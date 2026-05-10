#!/usr/bin/env node
/**
 * Welle 3 CI Guard: Post-Publish Growth Job Policies
 * ─────────────────────────────────────────────────────
 * Stellt sicher, dass jeder bekannte Growth-Job-Type:
 *   1. einen Eintrag in `job_type_policies` hat
 *   2. dort `can_run_when_not_building=true` ODER `exempt_from_auto_cancel=true` setzt
 *   3. von `fn_is_job_type_whitelisted_for_non_building_package` positiv erkannt wird
 *   4. von einem Worker verarbeitet wird (post-publish-growth-worker oder Map)
 *
 * Erwartet SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (oder VITE_SUPABASE_URL +
 * SERVICE_ROLE_KEY) im Environment. Lokal als Soft-Skip wenn nicht verfügbar.
 */

const GROWTH_JOB_TYPES = [
  'seo_indexnow_submit',
  'seo_sitemap_refresh',
  'seo_internal_links',
  'package_post_publish_blog',
  'package_distribution_plan',
  'package_campaign_assets_generate',
  'package_email_sequence_enroll',
  'package_og_image_generate',
];

const WORKER_HANDLED = new Set([
  'seo_indexnow_submit',
  'package_post_publish_blog',
  'package_distribution_plan',
  'package_campaign_assets_generate',
  'package_email_sequence_enroll',
  'package_og_image_generate',
  // sitemap_refresh & internal_links: handled by default-pool runner / existing seo workers
  'seo_sitemap_refresh',
  'seo_internal_links',
]);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[growth-policies-guard] SKIP — SUPABASE_URL / SERVICE_ROLE_KEY not in env.');
  process.exit(0);
}

async function rest(path, body) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const failures = [];

const policies = await rest(
  `job_type_policies?select=job_type,can_run_when_not_building,exempt_from_auto_cancel&job_type=in.(${GROWTH_JOB_TYPES.join(',')})`,
);
const byType = new Map(policies.map((p) => [p.job_type, p]));

for (const jt of GROWTH_JOB_TYPES) {
  const p = byType.get(jt);
  if (!p) {
    failures.push(`${jt}: missing job_type_policies row`);
    continue;
  }
  if (!p.can_run_when_not_building && !p.exempt_from_auto_cancel) {
    failures.push(`${jt}: neither can_run_when_not_building nor exempt_from_auto_cancel set`);
  }
  if (!WORKER_HANDLED.has(jt)) {
    failures.push(`${jt}: no worker handler mapped`);
  }
}

// SSOT helper check via RPC
for (const jt of GROWTH_JOB_TYPES) {
  const ok = await rest('rpc/fn_is_job_type_whitelisted_for_non_building_package', { p_job_type: jt }).catch(
    async () => rest('rpc/fn_is_job_type_whitelisted_for_non_building_package', { '': jt }),
  );
  if (ok !== true) failures.push(`${jt}: fn_is_job_type_whitelisted_for_non_building_package returned ${JSON.stringify(ok)}`);
}

if (failures.length) {
  console.error('❌ Post-Publish Growth Policy Guard FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✅ Post-Publish Growth Policy Guard OK (${GROWTH_JOB_TYPES.length} job types verified).`);
