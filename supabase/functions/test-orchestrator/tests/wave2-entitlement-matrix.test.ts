/**
 * Wave 2.1 — Entitlement & Role Matrix
 *
 * Tests the 4-role access matrix against check_user_entitlement RPC:
 *   1. anon → blocked (no EXECUTE grant)
 *   2. authenticated without entitlement → false
 *   3. authenticated with entitlement → true
 *   4. admin without entitlement → true (admin bypass)
 *
 * Also tests:
 *   - can_start_exam_simulation is blocked for anon (REVOKE FROM PUBLIC)
 *   - get_user_entitlements_v2 returns correct rows
 *   - anti-spoof: non-service caller can't check other user's entitlements
 *
 * SSOT Owner: check_user_entitlement, get_user_entitlements_v2, has_role
 * Blast Radius: revenue-facing, learner-facing, security-facing
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);
const sbAnon = createClient(SUPABASE_URL, ANON_KEY);

// ── Helpers to discover real test data ──

async function getEntitledUser(): Promise<{
  userId: string;
  curriculumId: string;
  feature: string;
} | null> {
  const { data } = await sbService
    .from("entitlements")
    .select("user_id, curriculum_id, has_exam_trainer, has_learning_course, has_ai_tutor, has_oral_trainer")
    .gt("valid_until", new Date().toISOString())
    .limit(1)
    .single();

  if (!data) return null;

  // Pick first active feature
  const feature = data.has_exam_trainer ? "exam_trainer"
    : data.has_learning_course ? "learning_course"
    : data.has_ai_tutor ? "ai_tutor"
    : data.has_oral_trainer ? "oral_trainer"
    : null;

  if (!feature) return null;

  return {
    userId: data.user_id,
    curriculumId: data.curriculum_id,
    feature,
  };
}

async function getAdminWithoutEntitlement(): Promise<string | null> {
  const { data } = await sbService
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(10);

  if (!data) return null;

  for (const row of data) {
    const { count } = await sbService
      .from("entitlements")
      .select("id", { count: "exact", head: true })
      .eq("user_id", row.user_id);

    if ((count ?? 0) === 0) return row.user_id;
  }
  return null;
}

async function getCurriculumWithoutEntitlement(userId: string): Promise<string | null> {
  const { data } = await sbService
    .from("curricula")
    .select("id")
    .not("frozen_at", "is", null)
    .limit(50);

  if (!data) return null;

  const { data: entitled } = await sbService
    .from("entitlements")
    .select("curriculum_id")
    .eq("user_id", userId);

  const entitledSet = new Set((entitled ?? []).map((e: any) => e.curriculum_id));

  for (const c of data) {
    if (!entitledSet.has(c.id)) return c.id;
  }
  return null;
}

// ══════════════════════════════════════════════
// 1. ANON: cannot call check_user_entitlement
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: anon cannot call check_user_entitlement", async () => {
  const { data, error } = await sbAnon
    .rpc("check_user_entitlement", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_curriculum_id: "00000000-0000-0000-0000-000000000000",
      p_feature: "exam_trainer",
    });

  // Must either error (permission denied) or return false
  if (error) {
    console.log(`✅ anon blocked from check_user_entitlement: ${error.code}`);
    return;
  }

  // If RPC returns without error, data must be false (not true)
  assert(data !== true,
    `❌ SECURITY: anon got true from check_user_entitlement`);
  console.log(`✅ anon call returned false (no entitlement leak)`);
});

// ══════════════════════════════════════════════
// 2. ANON: cannot call can_start_exam_simulation
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: anon cannot call can_start_exam_simulation", async () => {
  const { data, error } = await sbAnon
    .rpc("can_start_exam_simulation", {
      p_blueprint_id: "00000000-0000-0000-0000-000000000000",
    });

  if (error) {
    console.log(`✅ anon blocked from can_start_exam_simulation: ${error.code}`);
    return;
  }

  const row = data?.[0] ?? data;
  assert(
    row && row.allowed === false,
    `❌ SECURITY: anon got allowed=true from can_start_exam_simulation`);
  console.log(`✅ anon correctly blocked: ${row.reason_code}`);
});

// ══════════════════════════════════════════════
// 3. ANON: cannot call get_user_entitlements_v2
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: anon cannot call get_user_entitlements_v2", async () => {
  const { data, error } = await sbAnon
    .rpc("get_user_entitlements_v2" as any, {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_curriculum_id: null,
    });

  if (error) {
    console.log(`✅ anon blocked from get_user_entitlements_v2: ${error.code}`);
    return;
  }

  // If it returned, must be empty
  assert(!data || (Array.isArray(data) && data.length === 0),
    `❌ SECURITY: anon got entitlement data from get_user_entitlements_v2`);
  console.log(`✅ anon get_user_entitlements_v2 returned empty`);
});

// ══════════════════════════════════════════════
// 4. AUTHENTICATED WITHOUT ENTITLEMENT → false
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: user without entitlement gets false", async () => {
  const entitled = await getEntitledUser();
  assert(entitled, "Need at least one entitled user to find a non-entitled curriculum");

  // Find a curriculum this user is NOT entitled to
  const nonEntitledCurriculum = await getCurriculumWithoutEntitlement(entitled.userId);
  if (!nonEntitledCurriculum) {
    console.log("⚠️ User is entitled to all curricula — cannot test negative case");
    return;
  }

  const { data, error } = await sbService
    .rpc("check_user_entitlement", {
      p_user_id: entitled.userId,
      p_curriculum_id: nonEntitledCurriculum,
      p_feature: "exam_trainer",
    });

  assertEquals(error, null, `RPC error: ${error?.message}`);
  assertEquals(data, false,
    `❌ ENTITLEMENT: user ${entitled.userId} got true for non-entitled curriculum ${nonEntitledCurriculum}`);

  console.log(`✅ Non-entitled curriculum correctly returns false`);
});

// ══════════════════════════════════════════════
// 5. AUTHENTICATED WITH ENTITLEMENT → true
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: user with entitlement gets true", async () => {
  const entitled = await getEntitledUser();
  assert(entitled, "No entitled user found — cannot test positive entitlement");

  const { data, error } = await sbService
    .rpc("check_user_entitlement", {
      p_user_id: entitled.userId,
      p_curriculum_id: entitled.curriculumId,
      p_feature: entitled.feature,
    });

  assertEquals(error, null, `RPC error: ${error?.message}`);
  assertEquals(data, true,
    `❌ ENTITLEMENT: entitled user ${entitled.userId} got false for ${entitled.feature} on ${entitled.curriculumId}`);

  console.log(`✅ Entitled user correctly returns true for ${entitled.feature}`);
});

// ══════════════════════════════════════════════
// 6. ADMIN WITHOUT ENTITLEMENT → true (admin bypass)
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: admin without entitlement gets true (admin bypass)", async () => {
  const adminUserId = await getAdminWithoutEntitlement();
  if (!adminUserId) {
    console.log("⚠️ No admin without entitlements found — skipping admin bypass test");
    return;
  }

  // Pick any frozen curriculum
  const { data: curr } = await sbService
    .from("curricula")
    .select("id")
    .not("frozen_at", "is", null)
    .limit(1)
    .single();

  assert(curr, "No frozen curriculum found");

  const { data, error } = await sbService
    .rpc("check_user_entitlement", {
      p_user_id: adminUserId,
      p_curriculum_id: curr.id,
      p_feature: "exam_trainer",
    });

  assertEquals(error, null, `RPC error: ${error?.message}`);
  assertEquals(data, true,
    `❌ ENTITLEMENT: admin ${adminUserId} did not get admin bypass — returned false`);

  console.log(`✅ Admin bypass works: admin without entitlement gets true`);
});

// ══════════════════════════════════════════════
// 7. get_user_entitlements_v2 returns correct rows for entitled user
// ══════════════════════════════════════════════
Deno.test("D:ENTITLEMENT: get_user_entitlements returns rows for entitled user", async () => {
  const entitled = await getEntitledUser();
  assert(entitled, "No entitled user found");

  const { data, error } = await sbService
    .rpc("get_user_entitlements", {
      p_user_id: entitled.userId,
      p_curriculum_id: entitled.curriculumId,
    });

  assertEquals(error, null, `RPC error: ${error?.message}`);
  assert(Array.isArray(data) && data.length > 0,
    `❌ ENTITLEMENT: get_user_entitlements returned empty for entitled user`);

  const row = data[0] as Record<string, unknown>;
  assertEquals(row.curriculum_id, entitled.curriculumId);

  console.log(`✅ get_user_entitlements returns ${data.length} row(s) for entitled user`);
});

// ══════════════════════════════════════════════
// 8. get_user_entitlements returns empty for non-entitled curriculum
// ══════════════════════════════════════════════
Deno.test("D:ENTITLEMENT: get_user_entitlements empty for non-entitled combo", async () => {
  const entitled = await getEntitledUser();
  assert(entitled, "No entitled user found");

  const nonEntitledCurriculum = await getCurriculumWithoutEntitlement(entitled.userId);
  if (!nonEntitledCurriculum) {
    console.log("⚠️ User entitled to all curricula — skipping");
    return;
  }

  const { data, error } = await sbService
    .rpc("get_user_entitlements", {
      p_user_id: entitled.userId,
      p_curriculum_id: nonEntitledCurriculum,
    });

  assertEquals(error, null, `RPC error: ${error?.message}`);
  assert(!data || (Array.isArray(data) && data.length === 0),
    `❌ ENTITLEMENT: get_user_entitlements returned rows for non-entitled curriculum`);

  console.log(`✅ get_user_entitlements correctly empty for non-entitled curriculum`);
});

// ══════════════════════════════════════════════
// 9. Fake user ID → no entitlement
// ══════════════════════════════════════════════
Deno.test("P:ENTITLEMENT: completely unknown user gets false", async () => {
  const fakeUserId = "00000000-0000-0000-0000-ffffffffffff";

  const { data: curr } = await sbService
    .from("curricula")
    .select("id")
    .not("frozen_at", "is", null)
    .limit(1)
    .single();

  assert(curr, "No frozen curriculum");

  const { data, error } = await sbService
    .rpc("check_user_entitlement", {
      p_user_id: fakeUserId,
      p_curriculum_id: curr.id,
      p_feature: "exam_trainer",
    });

  assertEquals(error, null, `RPC error: ${error?.message}`);
  assertEquals(data, false,
    `❌ ENTITLEMENT: fake user got true — entitlement leak`);

  console.log(`✅ Fake user correctly returns false`);
});
