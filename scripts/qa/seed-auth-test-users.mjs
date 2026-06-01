#!/usr/bin/env node
/**
 * Seeds the Learner + Org test users used by tests/e2e/auth-org-context.spec.ts
 * against the configured Supabase backend. Idempotent — safe to run on every CI push.
 *
 * Creates / repairs:
 *   - learner@learner.de          (password: ExamFit_Test_2026!)
 *   - org@unternehmen.de          (password: ExamFit_Test_2026!)
 *   - Organization "Preview B2B Test GmbH" (org_type=COMPANY)
 *   - org_memberships: org user as owner
 *   - org_licenses: one active license (5 seats) tied to first active product
 *   - org_license_seats: one assigned seat for the org owner
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   E2E_LEARNER_EMAIL / E2E_LEARNER_PASSWORD
 *   E2E_ORG_EMAIL     / E2E_ORG_PASSWORD
 *   E2E_ORG_NAME      (default "Preview B2B Test GmbH")
 *
 * Exit 0 on success, 1 on any hard failure.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[seed-auth] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const LEARNER_EMAIL = process.env.E2E_LEARNER_EMAIL || 'learner@learner.de';
const LEARNER_PASSWORD = process.env.E2E_LEARNER_PASSWORD || 'ExamFit_Test_2026!';
const ORG_EMAIL = process.env.E2E_ORG_EMAIL || 'org@unternehmen.de';
const ORG_PASSWORD = process.env.E2E_ORG_PASSWORD || 'ExamFit_Test_2026!';
const ORG_NAME = process.env.E2E_ORG_NAME || 'Preview B2B Test GmbH';

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data?.users?.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (!data?.users || data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(email, password) {
  const existing = await findUserByEmail(email);
  if (existing) {
    // Force-reset password so CI always knows the password
    const { error } = await sb.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUserById(${email}): ${error.message}`);
    return existing.id;
  }
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { e2e_seed: true },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  return data.user.id;
}

async function ensureOrg(name) {
  const { data: existing, error: selErr } = await sb
    .from('organizations')
    .select('id')
    .eq('name', name)
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(`select org: ${selErr.message}`);
  if (existing) return existing.id;

  const { data, error } = await sb
    .from('organizations')
    .insert({ name, org_type: 'COMPANY', is_active: true })
    .select('id')
    .single();
  if (error) throw new Error(`insert org: ${error.message}`);
  return data.id;
}

async function ensureMembership(orgId, userId, role) {
  const { error } = await sb.from('org_memberships').upsert(
    {
      org_id: orgId,
      user_id: userId,
      role,
      status: 'active',
      source_type: 'manual',
    },
    { onConflict: 'org_id,user_id' },
  );
  if (error) throw new Error(`upsert membership: ${error.message}`);
}

async function ensureLicense(orgId) {
  const { data: prod, error: prodErr } = await sb
    .from('products')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (prodErr) throw new Error(`select product: ${prodErr.message}`);
  if (!prod) {
    console.warn('[seed-auth] no active product — skipping license seed');
    return null;
  }

  const { data: existing } = await sb
    .from('org_licenses')
    .select('id')
    .eq('org_id', orgId)
    .eq('product_id', prod.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await sb
    .from('org_licenses')
    .insert({
      org_id: orgId,
      product_id: prod.id,
      seat_count: 5,
      total_seats: 5,
      status: 'active',
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert license: ${error.message}`);
  return data.id;
}

async function ensureSeat(licenseId, userId) {
  if (!licenseId) return;
  const { data: existing } = await sb
    .from('org_license_seats')
    .select('id')
    .eq('license_id', licenseId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) return;
  const { error } = await sb.from('org_license_seats').insert({
    license_id: licenseId,
    user_id: userId,
    status: 'active',
    assigned_at: new Date().toISOString(),
  });
  if (error && !/duplicate|unique/i.test(error.message)) {
    throw new Error(`insert seat: ${error.message}`);
  }
}

async function main() {
  console.log('[seed-auth] starting…');
  console.log(`  url: ${SUPABASE_URL}`);
  console.log(`  learner: ${LEARNER_EMAIL}`);
  console.log(`  org user: ${ORG_EMAIL}  org: ${ORG_NAME}`);

  const learnerId = await ensureUser(LEARNER_EMAIL, LEARNER_PASSWORD);
  console.log(`  ✓ learner user ${learnerId}`);

  const orgUserId = await ensureUser(ORG_EMAIL, ORG_PASSWORD);
  console.log(`  ✓ org user ${orgUserId}`);

  const orgId = await ensureOrg(ORG_NAME);
  console.log(`  ✓ org ${orgId}`);

  await ensureMembership(orgId, orgUserId, 'owner');
  console.log('  ✓ org owner membership');

  const licenseId = await ensureLicense(orgId);
  if (licenseId) console.log(`  ✓ license ${licenseId}`);

  await ensureSeat(licenseId, orgUserId);
  console.log('  ✓ seat assignment');

  console.log('[seed-auth] DONE');
}

main().catch((err) => {
  console.error('[seed-auth] FATAL', err?.message || err);
  process.exit(1);
});
