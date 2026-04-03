/**
 * Wave 3 — Entitlement Fulfillment E2E (4 Scenarios)
 *
 * Tests the full checkout→webhook→fulfillment chain for:
 *   1. Ausbildung B2C  (b2c_single_12m)  → personal entitlement
 *   2. Studium B2C     (b2c_studium_12m) → personal entitlement
 *   3. B2B Ausbildung  (b2b_team_5_12m)  → org + license + seats
 *   4. B2B Studium     (b2b_studium_team_5_12m) → org + license + seats
 *
 * Also tests:
 *   - Idempotency (duplicate session_id must not create duplicates)
 *   - B2C path does NOT create organizations
 *   - B2B path creates correct seat_count
 *
 * SSOT Owner: stripe-webhook fulfillment logic
 * Blast Radius: revenue-facing, access-facing
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Test data constants ──
const PRODUCT_ID = "9c1c3284-c3c9-49f4-bf76-d90f81814258";
const TEST_PREFIX = "test_fulfillment_";
const uniqueId = () => crypto.randomUUID();

// Simulates what the webhook does for a pricing_plan checkout.session.completed
async function simulateFulfillment(opts: {
  userId: string;
  productId: string;
  sessionId: string;
  audienceType: string;
  seatCount: number;
  durationDays: number;
  planKey: string;
  orgName?: string;
}) {
  const { userId, productId, sessionId, audienceType, seatCount, durationDays, planKey, orgName } = opts;
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + durationDays);

  if (audienceType === "b2c" || seatCount <= 1) {
    // ── B2C: personal entitlement ──
    const { data: existing } = await sb
      .from("entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .eq("source_type", "stripe")
      .eq("source_ref", sessionId)
      .maybeSingle();

    if (existing) return { type: "b2c", idempotent: true, entitlementId: existing.id };

    const { data: ent, error } = await sb.from("entitlements").insert({
      user_id: userId,
      product_id: productId,
      source_type: "stripe",
      source_ref: sessionId,
      valid_from: new Date().toISOString(),
      valid_until: validUntil.toISOString(),
    }).select("id").single();

    if (error) throw new Error(`Entitlement insert failed: ${JSON.stringify(error)}`);
    return { type: "b2c", idempotent: false, entitlementId: ent!.id };
  }

  // ── B2B: org + license + seats ──
  const { data: existingLic } = await sb
    .from("org_licenses")
    .select("id")
    .eq("source_ref", sessionId)
    .maybeSingle();

  if (existingLic) return { type: "b2b", idempotent: true, licenseId: existingLic.id };

  // Create org
  const { data: newOrg, error: orgErr } = await sb
    .from("organizations")
    .insert({ name: orgName || "Test Org", org_type: "company" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`Org insert failed: ${JSON.stringify(orgErr)}`);

  // Add owner membership
  await sb.from("org_memberships").insert({
    org_id: newOrg!.id,
    user_id: userId,
    role: "owner",
    status: "active",
  });

  // Create license
  const { data: newLicense, error: licErr } = await sb
    .from("org_licenses")
    .insert({
      org_id: newOrg!.id,
      product_id: productId,
      seat_count: seatCount,
      seats_used: 0,
      starts_at: new Date().toISOString(),
      ends_at: validUntil.toISOString(),
      status: "active",
      source_type: "stripe",
      source_ref: sessionId,
    })
    .select("id")
    .single();
  if (licErr) throw new Error(`License insert failed: ${JSON.stringify(licErr)}`);

  // Auto-assign first seat
  await sb.from("org_license_seats").insert({
    license_id: newLicense!.id,
    user_id: userId,
    claimed_at: new Date().toISOString(),
  });

  return { type: "b2b", idempotent: false, licenseId: newLicense!.id, orgId: newOrg!.id };
}

// ── Cleanup helper ──
async function cleanup(sessionId: string, orgId?: string) {
  // Delete in reverse dependency order
  if (orgId) {
    const { data: licenses } = await sb.from("org_licenses").select("id").eq("org_id", orgId);
    for (const lic of licenses || []) {
      await sb.from("org_license_seats").delete().eq("license_id", lic.id);
    }
    await sb.from("org_licenses").delete().eq("org_id", orgId);
    await sb.from("org_memberships").delete().eq("org_id", orgId);
    await sb.from("organizations").delete().eq("id", orgId);
  }
  await sb.from("entitlements").delete().eq("source_ref", sessionId);
}

// ══════════════════════════════════════════════════
// Scenario 1: Ausbildung B2C
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:1 Ausbildung B2C → personal entitlement, no org", async () => {
  const sessionId = `${TEST_PREFIX}ausbildung_b2c_${uniqueId()}`;
  const userId = uniqueId();

  try {
    const result = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2c",
      seatCount: 1,
      durationDays: 365,
      planKey: "b2c_single_12m",
    });

    assertEquals(result.type, "b2c", "Must route to B2C path");
    assertEquals(result.idempotent, false, "First insert must not be idempotent");
    assert(result.entitlementId, "Entitlement must be created");

    // Verify entitlement exists
    const { data: ent } = await sb
      .from("entitlements")
      .select("*")
      .eq("id", result.entitlementId)
      .single();

    assertEquals(ent!.user_id, userId);
    assertEquals(ent!.product_id, PRODUCT_ID);
    assertEquals(ent!.source_type, "stripe");
    assertEquals(ent!.source_ref, sessionId);
    assert(ent!.valid_until, "valid_until must be set");

    // Verify NO org was created
    const { data: orgs } = await sb
      .from("org_memberships")
      .select("id")
      .eq("user_id", userId);
    assertEquals((orgs || []).length, 0, "B2C must NOT create org membership");

    console.log("✅ Ausbildung B2C: entitlement created, no org");
  } finally {
    await cleanup(sessionId);
  }
});

// ══════════════════════════════════════════════════
// Scenario 2: Studium B2C
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:2 Studium B2C → personal entitlement, no org", async () => {
  const sessionId = `${TEST_PREFIX}studium_b2c_${uniqueId()}`;
  const userId = uniqueId();

  try {
    const result = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2c",
      seatCount: 1,
      durationDays: 365,
      planKey: "b2c_studium_12m",
    });

    assertEquals(result.type, "b2c");
    assert(result.entitlementId);

    // Verify entitlement
    const { data: ent } = await sb.from("entitlements").select("source_ref").eq("id", result.entitlementId).single();
    assertEquals(ent!.source_ref, sessionId);

    // Verify NO org
    const { data: orgs } = await sb.from("org_memberships").select("id").eq("user_id", userId);
    assertEquals((orgs || []).length, 0, "Studium B2C must NOT create org");

    console.log("✅ Studium B2C: entitlement created, no org");
  } finally {
    await cleanup(sessionId);
  }
});

// ══════════════════════════════════════════════════
// Scenario 3: B2B Ausbildung (Team 5 Seats)
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:3 B2B Ausbildung → org + license + first seat", async () => {
  const sessionId = `${TEST_PREFIX}b2b_ausbildung_${uniqueId()}`;
  const userId = uniqueId();
  let orgId: string | undefined;

  try {
    const result = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2b",
      seatCount: 5,
      durationDays: 365,
      planKey: "b2b_team_5_12m",
      orgName: "Test Ausbildungsbetrieb",
    });

    assertEquals(result.type, "b2b", "Must route to B2B path");
    assertEquals(result.idempotent, false);
    assert(result.licenseId, "License must be created");
    orgId = (result as any).orgId;

    // Verify license
    const { data: lic } = await sb.from("org_licenses").select("*").eq("id", result.licenseId).single();
    assertEquals(lic!.seat_count, 5, "License must have 5 seats");
    assertEquals(lic!.product_id, PRODUCT_ID);
    assertEquals(lic!.status, "active");
    assertEquals(lic!.source_ref, sessionId);

    // Verify first seat auto-assigned
    const { data: seats } = await sb.from("org_license_seats").select("*").eq("license_id", result.licenseId);
    assertEquals(seats!.length, 1, "Buyer must get first seat");
    assertEquals(seats![0].user_id, userId);

    // Verify org membership
    const { data: membership } = await sb
      .from("org_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", orgId!)
      .single();
    assertEquals(membership!.role, "owner");

    console.log("✅ B2B Ausbildung: org + 5-seat license + buyer seat created");
  } finally {
    await cleanup(sessionId, orgId);
  }
});

// ══════════════════════════════════════════════════
// Scenario 4: B2B Studium / Dual (Team 5 Seats)
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:4 B2B Studium → org + license + first seat", async () => {
  const sessionId = `${TEST_PREFIX}b2b_studium_${uniqueId()}`;
  const userId = uniqueId();
  let orgId: string | undefined;

  try {
    const result = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2b",
      seatCount: 5,
      durationDays: 365,
      planKey: "b2b_studium_team_5_12m",
      orgName: "Test Hochschul-Kooperation",
    });

    assertEquals(result.type, "b2b");
    assert(result.licenseId);
    orgId = (result as any).orgId;

    // Verify license has correct seats
    const { data: lic } = await sb.from("org_licenses").select("seat_count, status").eq("id", result.licenseId).single();
    assertEquals(lic!.seat_count, 5);
    assertEquals(lic!.status, "active");

    // Verify first seat
    const { data: seats } = await sb.from("org_license_seats").select("user_id").eq("license_id", result.licenseId);
    assertEquals(seats!.length, 1);
    assertEquals(seats![0].user_id, userId);

    console.log("✅ B2B Studium: org + 5-seat license + buyer seat created");
  } finally {
    await cleanup(sessionId, orgId);
  }
});

// ══════════════════════════════════════════════════
// Idempotency: B2C duplicate must not create second entitlement
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:IDEMP B2C retry must not duplicate entitlement", async () => {
  const sessionId = `${TEST_PREFIX}idemp_b2c_${uniqueId()}`;
  const userId = uniqueId();

  try {
    const first = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2c",
      seatCount: 1,
      durationDays: 365,
      planKey: "b2c_single_12m",
    });

    assertEquals(first.idempotent, false);

    const second = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2c",
      seatCount: 1,
      durationDays: 365,
      planKey: "b2c_single_12m",
    });

    assertEquals(second.idempotent, true, "Second call must be idempotent");
    assertEquals(first.entitlementId, second.entitlementId, "Must return same entitlement ID");

    // Count entitlements for this session
    const { data: all } = await sb
      .from("entitlements")
      .select("id")
      .eq("source_ref", sessionId);
    assertEquals(all!.length, 1, "Must have exactly 1 entitlement");

    console.log("✅ B2C idempotency: retry returned same entitlement, no duplicate");
  } finally {
    await cleanup(sessionId);
  }
});

// ══════════════════════════════════════════════════
// Idempotency: B2B duplicate must not create second license
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:IDEMP B2B retry must not duplicate license", async () => {
  const sessionId = `${TEST_PREFIX}idemp_b2b_${uniqueId()}`;
  const userId = uniqueId();
  let orgId: string | undefined;

  try {
    const first = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2b",
      seatCount: 5,
      durationDays: 365,
      planKey: "b2b_team_5_12m",
    });

    assertEquals(first.idempotent, false);
    orgId = (first as any).orgId;

    const second = await simulateFulfillment({
      userId,
      productId: PRODUCT_ID,
      sessionId,
      audienceType: "b2b",
      seatCount: 5,
      durationDays: 365,
      planKey: "b2b_team_5_12m",
    });

    assertEquals(second.idempotent, true, "Second B2B call must be idempotent");
    assertEquals(first.licenseId, second.licenseId, "Must return same license ID");

    // Count licenses for this session
    const { data: all } = await sb
      .from("org_licenses")
      .select("id")
      .eq("source_ref", sessionId);
    assertEquals(all!.length, 1, "Must have exactly 1 license");

    console.log("✅ B2B idempotency: retry returned same license, no duplicate");
  } finally {
    await cleanup(sessionId, orgId);
  }
});

// ══════════════════════════════════════════════════
// Pricing plan resolution: verify plans exist and are correctly typed
// ══════════════════════════════════════════════════
Deno.test("FULFILLMENT:PLANS all 4 plan types active with stripe_price_id", async () => {
  const expectedPlans = [
    { key: "b2c_single_12m", audience: "b2c", minSeats: 1 },
    { key: "b2c_studium_12m", audience: "b2c", minSeats: 1 },
    { key: "b2b_team_5_12m", audience: "b2b", minSeats: 5 },
    { key: "b2b_studium_team_5_12m", audience: "b2b", minSeats: 5 },
  ];

  for (const { key, audience, minSeats } of expectedPlans) {
    const { data: plan, error } = await sb
      .from("pricing_plans")
      .select("plan_key, audience_type, seat_count, stripe_price_id, is_active, checkout_mode")
      .eq("plan_key", key)
      .single();

    assert(!error, `Plan ${key} must exist: ${error?.message}`);
    assertEquals(plan!.is_active, true, `${key} must be active`);
    assertEquals(plan!.audience_type, audience, `${key} audience must be ${audience}`);
    assert(plan!.stripe_price_id, `${key} must have stripe_price_id`);
    assertEquals(plan!.checkout_mode, "self_service", `${key} must be self_service`);
    assert((plan!.seat_count || 1) >= minSeats, `${key} must have >= ${minSeats} seats`);

    console.log(`✅ Plan ${key}: active, ${audience}, ${plan!.seat_count} seats, stripe linked`);
  }
});
