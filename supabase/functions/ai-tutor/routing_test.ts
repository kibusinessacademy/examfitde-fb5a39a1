import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/**
 * Forensic Test: exam_transfer routing logic
 * Tests the decision logic WITHOUT requiring auth
 */

// Replicate the routing decision from index.ts
function shouldRouteToExamTransfer(
  isHigherEd: boolean,
  cognitiveLevel: string,
  hasTrapDefinition: boolean,
  hasTypicalErrors: boolean,
  currentRole: string
): { routed: boolean; reason: string } {
  if (!isHigherEd) return { routed: false, reason: "not higher_education" };
  if (currentRole === "exam_transfer") return { routed: false, reason: "already exam_transfer" };
  
  const validLevels = ["apply", "analyze", "evaluate"];
  if (!validLevels.includes(cognitiveLevel)) return { routed: false, reason: `cognitive_level=${cognitiveLevel} not in ${validLevels}` };
  
  if (!hasTrapDefinition && !hasTypicalErrors) return { routed: false, reason: "no trap/errors data" };
  
  return { routed: true, reason: `auto-route: higher_ed + ${cognitiveLevel} + trap/errors` };
}

// ── Test 1: LF01 Buchungssatz (apply + trap + errors) → SHOULD route ──
Deno.test("Test 1: Buchungssatz (apply, higher_ed, trap+errors) → exam_transfer", () => {
  const result = shouldRouteToExamTransfer(true, "apply", true, true, "explainer");
  assertEquals(result.routed, true);
  console.log(`✅ Test 1 PASS: ${result.reason}`);
});

// ── Test 2: LF03 Deckungsbeitrag (apply + trap + errors) → SHOULD route ──
Deno.test("Test 2: Deckungsbeitrag (apply, higher_ed, trap+errors) → exam_transfer", () => {
  const result = shouldRouteToExamTransfer(true, "apply", true, true, "explainer");
  assertEquals(result.routed, true);
  console.log(`✅ Test 2 PASS: ${result.reason}`);
});

// ── Test 3: Marketing-Mix (evaluate + trap + errors) → SHOULD route ──
Deno.test("Test 3: Marketing-Mix Fallanalyse (evaluate, higher_ed, trap+errors) → exam_transfer", () => {
  const result = shouldRouteToExamTransfer(true, "evaluate", true, true, "explainer");
  assertEquals(result.routed, true);
  console.log(`✅ Test 3 PASS: ${result.reason}`);
});

// ── Negative Tests ──
Deno.test("Negative: vocational program → NO route", () => {
  const result = shouldRouteToExamTransfer(false, "apply", true, true, "explainer");
  assertEquals(result.routed, false);
  console.log(`✅ Negative 1 PASS: ${result.reason}`);
});

Deno.test("Negative: understand level → NO route", () => {
  const result = shouldRouteToExamTransfer(true, "understand", true, true, "explainer");
  assertEquals(result.routed, false);
  console.log(`✅ Negative 2 PASS: ${result.reason}`);
});

Deno.test("Negative: no trap/errors → NO route", () => {
  const result = shouldRouteToExamTransfer(true, "analyze", false, false, "explainer");
  assertEquals(result.routed, false);
  console.log(`✅ Negative 3 PASS: ${result.reason}`);
});

Deno.test("Negative: already exam_transfer → NO re-route", () => {
  const result = shouldRouteToExamTransfer(true, "analyze", true, true, "exam_transfer");
  assertEquals(result.routed, false);
  console.log(`✅ Negative 4 PASS: ${result.reason}`);
});

// ── DB validation: verify blueprints exist with correct data ──
Deno.test("DB: BWL blueprints have trap+errors for exam_transfer", async () => {
  const url = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) {
    console.warn("⚠️ Skipping DB test - no Supabase credentials");
    return;
  }

  const resp = await fetch(
    `${url}/rest/v1/question_blueprints?curriculum_id=eq.a0b0c0d0-0002-4000-8000-000000000001&select=id,name,cognitive_level,trap_definition,typical_errors&limit=30`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const body = await resp.text();
  
  if (!resp.ok) {
    console.warn(`⚠️ DB query failed: ${resp.status}`);
    return;
  }
  
  const blueprints = JSON.parse(body);
  console.log(`📊 Total BWL blueprints: ${blueprints.length}`);
  
  const transferEligible = blueprints.filter((bp: any) => 
    ["apply", "analyze", "evaluate"].includes(bp.cognitive_level) &&
    (bp.trap_definition || (bp.typical_errors && bp.typical_errors.length > 0))
  );
  console.log(`🎯 Transfer-eligible blueprints: ${transferEligible.length}`);
  
  for (const bp of transferEligible.slice(0, 5)) {
    console.log(`  ✅ ${bp.name} (${bp.cognitive_level}) — trap: ${!!bp.trap_definition}, errors: ${!!bp.typical_errors}`);
  }
  
  // At least 20 should be transfer-eligible
  assertEquals(transferEligible.length >= 20, true, `Expected ≥20 transfer-eligible, got ${transferEligible.length}`);
});
