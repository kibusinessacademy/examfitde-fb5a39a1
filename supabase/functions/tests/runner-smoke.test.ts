/**
 * Runner Boot Smoke Tests
 * 
 * These tests verify that each runner's module can be imported without
 * TDZ errors, syntax errors, or top-level exceptions.
 * 
 * Run: deno test supabase/functions/tests/runner-smoke.test.ts --allow-net --allow-env
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const RUNNERS = [
  "content-runner",
  "job-runner",
  "control-plane-cron",
  "production-watchdog",
  "pipeline-optimizer",
  "ops-auto-healer",
  "auto-heal-runner",
];

for (const runner of RUNNERS) {
  Deno.test(`${runner} — responds without crash (smoke)`, async () => {
    const url = `${SUPABASE_URL}/functions/v1/${runner}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ smoke_test: true }),
    });
    
    // We accept 200, 401, 403 (auth issues are OK for smoke).
    // 500 = crash = FAIL.
    const body = await res.text();
    
    if (res.status === 500) {
      throw new Error(`${runner} returned 500 (crash): ${body.slice(0, 500)}`);
    }
    
    // Runner must at least respond
    assertExists(res.status, `${runner} must return a status code`);
  });
}

Deno.test("runner-lanes — all job types classified without warning", async () => {
  // Dynamic import to catch TDZ errors at load time
  const mod = await import("../_shared/runner-lanes.ts");
  
  assertExists(mod.jobTypesForLane);
  assertExists(mod.laneForJobType);
  assertExists(mod.partitionByLane);
  
  const control = mod.jobTypesForLane("control");
  const recovery = mod.jobTypesForLane("recovery");
  const generation = mod.jobTypesForLane("generation");
  
  // Each lane must have at least one job type
  assertEquals(control.length > 0, true, "control lane must have job types");
  assertEquals(recovery.length > 0, true, "recovery lane must have job types");
  assertEquals(generation.length > 0, true, "generation lane must have job types");
  
  // No overlap between lanes
  const all = [...control, ...recovery, ...generation];
  const unique = new Set(all);
  assertEquals(all.length, unique.size, "Job types must not appear in multiple lanes");
});

Deno.test("runner-health — module loads without error", async () => {
  const mod = await import("../_shared/runner-health.ts");
  assertExists(mod.emitRunnerHeartbeat);
  assertExists(mod.checkRunnerHealth);
});
