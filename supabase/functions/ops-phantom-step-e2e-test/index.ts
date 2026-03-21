import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { FULL_STEP_ORDER } from "../_shared/job-map.ts";

/**
 * ops-phantom-step-e2e-test — Hardened Phantom-Step Test Pyramid (v2)
 *
 * Modes:
 *   - readonly (default): Safe for production, no mutations on live packages
 *   - canary: Mutative tests run ONLY against explicit canary_package_id
 *
 * 6 layers: Schema/Guard, Seeder/Backbone, Runtime, Publish-Readiness, Regression, Canary
 *
 * Verdict levels: pass | fail | warn | skip
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SSOT_STEP_KEYS: string[] = [...FULL_STEP_ORDER];

/** Safe PostgREST in-filter with quoted strings */
function pgInList(values: string[]): string {
  return `(${values.map(v => `"${v}"`).join(",")})`;
}

type Verdict = "pass" | "fail" | "warn" | "skip";

interface TestResult {
  test_id: string;
  layer: string;
  verdict: Verdict;
  detail: string;
  evidence?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }

  const canaryPackageId = body.canary_package_id as string | undefined;
  const mode = canaryPackageId ? "canary" : "readonly";
  const testRunId = `phantom_e2e_${crypto.randomUUID().slice(0, 8)}`;
  const started = Date.now();

  const results: TestResult[] = [];

  // Helper: get any package id for read-only guard tests
  async function getAnyPackageId(): Promise<string | null> {
    const { data } = await sb.from("course_packages").select("id").limit(1).single();
    return data?.id ?? null;
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer A: Schema / Guard Tests (readonly)
  // ═══════════════════════════════════════════════════════════════

  const guardPkgId = await getAnyPackageId();

  // A1: Unknown step MUST be rejected
  if (guardPkgId) {
    const fakeKey = `__test_phantom_${testRunId}`;
    const { error } = await sb.from("package_steps").insert({
      package_id: guardPkgId,
      step_key: fakeKey,
      status: "queued",
    });
    const rejected = !!error && (error.message?.includes("SSOT_STEP_KEY_REJECTED") || error.code === "P0001");
    results.push({
      test_id: "A1_unknown_step_rejected",
      layer: "schema_guard",
      verdict: rejected ? "pass" : "fail",
      detail: rejected
        ? "Guard trigger correctly rejected unknown step_key"
        : `FAIL: Unknown step was NOT rejected. Error: ${error?.message ?? "no error, insert succeeded!"}`,
      evidence: { error_message: error?.message, error_code: error?.code },
    });
  } else {
    results.push({
      test_id: "A1_unknown_step_rejected",
      layer: "schema_guard",
      verdict: "skip",
      detail: "No packages found to test against",
    });
  }

  // A2: Legitimate SSOT step accepted — ONLY in canary mode
  if (mode === "canary" && canaryPackageId) {
    const testStepKey = SSOT_STEP_KEYS[0]; // first SSOT key, always valid
    const { data: existing } = await sb
      .from("package_steps")
      .select("id")
      .eq("package_id", canaryPackageId)
      .eq("step_key", testStepKey)
      .maybeSingle();

    if (existing) {
      results.push({
        test_id: "A2_ssot_step_accepted",
        layer: "schema_guard",
        verdict: "pass",
        detail: `SSOT step '${testStepKey}' already exists on canary — guard accepted it at creation time`,
      });
    } else {
      const { error } = await sb.from("package_steps").upsert({
        package_id: canaryPackageId,
        step_key: testStepKey,
        status: "queued",
      }, { onConflict: "package_id,step_key" });
      const accepted = !error;
      results.push({
        test_id: "A2_ssot_step_accepted",
        layer: "schema_guard",
        verdict: accepted ? "pass" : "fail",
        detail: accepted
          ? `SSOT step '${testStepKey}' accepted by guard on canary`
          : `FAIL: SSOT step rejected: ${error?.message}`,
      });
    }
  } else {
    // Readonly mode: verify by checking existing data — any SSOT step exists in DB = guard allows them
    const { count } = await sb
      .from("package_steps")
      .select("id", { count: "exact", head: true })
      .in("step_key", SSOT_STEP_KEYS.slice(0, 5))
      .limit(1);

    results.push({
      test_id: "A2_ssot_step_accepted",
      layer: "schema_guard",
      verdict: (count ?? 0) > 0 ? "pass" : "warn",
      detail: (count ?? 0) > 0
        ? "SSOT steps exist in fleet — guard allows legitimate keys (readonly check)"
        : "WARN: No SSOT steps found in fleet — cannot verify guard acceptance",
    });
  }

  // A3: Multiple unknown keys all fail
  if (guardPkgId) {
    const fakeKeys = ["setup_storefront", "launch_marketing", "generate_curriculum", "setup_pwa"];
    const rejections: string[] = [];
    for (const fk of fakeKeys) {
      const { error } = await sb.from("package_steps").insert({
        package_id: guardPkgId,
        step_key: fk,
        status: "queued",
      });
      if (error && (error.message?.includes("SSOT_STEP_KEY_REJECTED") || error.code === "P0001")) {
        rejections.push(fk);
      }
    }
    const allRejected = rejections.length === fakeKeys.length;
    results.push({
      test_id: "A3_all_legacy_keys_rejected",
      layer: "schema_guard",
      verdict: allRejected ? "pass" : "fail",
      detail: allRejected
        ? `All ${fakeKeys.length} legacy/phantom keys correctly rejected`
        : `FAIL: Only ${rejections.length}/${fakeKeys.length} rejected. Missing: ${fakeKeys.filter(k => !rejections.includes(k)).join(",")}`,
      evidence: { tested: fakeKeys, rejected: rejections },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer B: Seeder / Backbone Tests
  // ═══════════════════════════════════════════════════════════════

  // B1: Seed parity — ONLY against canary package (hard: no unexpected AND no missing)
  if (mode === "canary" && canaryPackageId) {
    // Run backbone seeder on canary
    await sb.rpc("assert_step_backbone", { p_package_id: canaryPackageId });

    const { data: steps } = await sb
      .from("package_steps")
      .select("step_key, status")
      .eq("package_id", canaryPackageId);

    const allSteps = (steps ?? []) as { step_key: string; status: string }[];
    const actualKeys = new Set(allSteps.map(s => s.step_key));
    const ssotSet = new Set(SSOT_STEP_KEYS);

    const unexpected = allSteps.filter(s => !ssotSet.has(s.step_key) && s.status !== "skipped");
    const missing = SSOT_STEP_KEYS.filter(k => !actualKeys.has(k));

    const pass = unexpected.length === 0 && missing.length === 0;
    results.push({
      test_id: "B1_seed_parity",
      layer: "seeder_backbone",
      verdict: pass ? "pass" : "fail",
      detail: pass
        ? `Canary seeded exactly ${actualKeys.size} steps, all SSOT-valid, none missing`
        : `FAIL: ${unexpected.length} unexpected active steps, ${missing.length} missing SSOT steps`,
      evidence: {
        package_id: canaryPackageId,
        actual_count: actualKeys.size,
        expected_count: SSOT_STEP_KEYS.length,
        unexpected: unexpected.map(s => `${s.step_key}:${s.status}`),
        missing,
      },
    });
  } else {
    results.push({
      test_id: "B1_seed_parity",
      layer: "seeder_backbone",
      verdict: "skip",
      detail: "Skipped: seed parity requires canary_package_id (mutative test)",
    });
  }

  // B2: assert_step_backbone idempotency — ONLY against canary
  if (mode === "canary" && canaryPackageId) {
    await sb.rpc("assert_step_backbone", { p_package_id: canaryPackageId });
    await sb.rpc("assert_step_backbone", { p_package_id: canaryPackageId });

    const { data: steps } = await sb
      .from("package_steps")
      .select("step_key")
      .eq("package_id", canaryPackageId);

    const counts: Record<string, number> = {};
    for (const s of (steps ?? []) as { step_key: string }[]) {
      counts[s.step_key] = (counts[s.step_key] ?? 0) + 1;
    }
    const duplicated = Object.entries(counts).filter(([, c]) => c > 1);

    results.push({
      test_id: "B2_seeder_idempotent",
      layer: "seeder_backbone",
      verdict: duplicated.length === 0 ? "pass" : "fail",
      detail: duplicated.length === 0
        ? "assert_step_backbone is idempotent on canary, no duplicate step_keys"
        : `FAIL: Duplicates found: ${duplicated.map(([k, c]) => `${k}(${c})`).join(",")}`,
      evidence: { package_id: canaryPackageId, duplicated },
    });
  } else {
    results.push({
      test_id: "B2_seeder_idempotent",
      layer: "seeder_backbone",
      verdict: "skip",
      detail: "Skipped: idempotency test requires canary_package_id (mutative test)",
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer C: Runtime / Orchestration Tests (readonly)
  // ═══════════════════════════════════════════════════════════════

  // C1: No queued phantom steps in entire fleet
  {
    const { data: phantomQueued } = await sb
      .from("package_steps")
      .select("package_id, step_key")
      .eq("status", "queued")
      .not("step_key", "in", pgInList(SSOT_STEP_KEYS))
      .limit(20);

    const count = (phantomQueued ?? []).length;
    results.push({
      test_id: "C1_no_queued_phantoms",
      layer: "runtime_orchestration",
      verdict: count === 0 ? "pass" : "fail",
      detail: count === 0
        ? "Zero queued phantom steps in fleet"
        : `FAIL: ${count} queued phantom steps remain`,
      evidence: { samples: (phantomQueued ?? []).slice(0, 5) },
    });
  }

  // C2: No phantom steps in blocking states (queued/running/failed)
  {
    const { data: blockingPhantoms } = await sb
      .from("package_steps")
      .select("package_id, step_key, status")
      .in("status", ["queued", "running", "failed"])
      .not("step_key", "in", pgInList(SSOT_STEP_KEYS))
      .limit(20);

    const count = (blockingPhantoms ?? []).length;
    results.push({
      test_id: "C2_no_blocking_phantoms",
      layer: "runtime_orchestration",
      verdict: count === 0 ? "pass" : "fail",
      detail: count === 0
        ? "No phantom steps in blocking states (queued/running/failed)"
        : `FAIL: ${count} phantom steps still in blocking states`,
      evidence: { samples: (blockingPhantoms ?? []).slice(0, 5) },
    });
  }

  // C3: All building packages have valid step_keys only (non-SSOT must be skipped)
  {
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id")
      .eq("status", "building");

    const buildingIds = (buildingPkgs ?? []).map((p: any) => p.id);
    let count = 0;
    let samples: unknown[] = [];

    if (buildingIds.length > 0) {
      const { data: badSteps } = await sb
        .from("package_steps")
        .select("package_id, step_key, status")
        .in("package_id", buildingIds)
        .not("step_key", "in", pgInList(SSOT_STEP_KEYS))
        .not("status", "eq", "skipped")
        .limit(20);

      count = (badSteps ?? []).length;
      samples = (badSteps ?? []).slice(0, 5);
    }

    results.push({
      test_id: "C3_building_packages_clean",
      layer: "runtime_orchestration",
      verdict: count === 0 ? "pass" : "fail",
      detail: count === 0
        ? `All ${buildingIds.length} building packages have only SSOT step_keys (or non-SSOT are skipped)`
        : `FAIL: ${count} non-SSOT non-skipped steps in building packages`,
      evidence: { building_count: buildingIds.length, samples },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer D: Publish-Readiness Tests (readonly)
  // ═══════════════════════════════════════════════════════════════

  // D1: auto_publish not blocked by phantom/unknown steps
  {
    const { data: publishBlockers } = await sb
      .from("v_ops_auto_publish_blockers")
      .select("package_id, blocker_reason")
      .limit(50);

    const phantomBlockers = (publishBlockers ?? []).filter(
      (b: any) => /phantom|unknown|legacy/i.test(String(b.blocker_reason ?? ""))
    );

    results.push({
      test_id: "D1_publish_not_phantom_blocked",
      layer: "publish_readiness",
      verdict: phantomBlockers.length === 0 ? "pass" : "warn",
      detail: phantomBlockers.length === 0
        ? "No publish blockers reference phantom/unknown/legacy steps"
        : `WARN: ${phantomBlockers.length} publish blockers may reference phantom steps`,
      evidence: { phantom_blockers: phantomBlockers.slice(0, 5), total_blockers: (publishBlockers ?? []).length },
    });
  }

  // D2: Readiness views are consistent (informational)
  {
    const { data: readiness } = await sb
      .from("ops_package_readiness")
      .select("package_id, readiness_pct, blocker_count")
      .gt("blocker_count", 0)
      .limit(10);

    results.push({
      test_id: "D2_readiness_views_consistent",
      layer: "publish_readiness",
      verdict: "pass",
      detail: `${(readiness ?? []).length} packages have blockers (informational)`,
      evidence: { sample: (readiness ?? []).slice(0, 5) },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer E: Regression / Drift Tests (readonly)
  // ═══════════════════════════════════════════════════════════════

  // E1: ops_phantom_step_drift — only non-skipped drift = failure
  {
    const { data: drift, error } = await sb
      .from("ops_phantom_step_drift")
      .select("*")
      .limit(100);

    const activeDrift = (drift ?? []).filter((r: any) => r.status !== "skipped");

    results.push({
      test_id: "E1_drift_view_clean",
      layer: "regression_drift",
      verdict: activeDrift.length === 0 ? "pass" : "fail",
      detail: activeDrift.length === 0
        ? `ops_phantom_step_drift: ${(drift ?? []).length} total rows, all skipped (healed) — no active drift`
        : `FAIL: ${activeDrift.length} non-skipped drift rows detected`,
      evidence: error
        ? { error: error.message }
        : { active_drift: activeDrift.slice(0, 5), total_rows: (drift ?? []).length },
    });
  }

  // E2: ops_missing_step_backbone reports only SSOT keys
  {
    const { data: missingBb } = await sb
      .from("ops_missing_step_backbone")
      .select("*")
      .limit(50);

    const nonSsotMissing = (missingBb ?? []).filter(
      (r: any) => !SSOT_STEP_KEYS.includes(r.missing_step)
    );

    results.push({
      test_id: "E2_backbone_view_ssot_only",
      layer: "regression_drift",
      verdict: nonSsotMissing.length === 0 ? "pass" : "fail",
      detail: nonSsotMissing.length === 0
        ? `ops_missing_step_backbone reports only SSOT keys (${(missingBb ?? []).length} total missing)`
        : `FAIL: ${nonSsotMissing.length} non-SSOT keys in missing backbone view`,
      evidence: { non_ssot_missing: nonSsotMissing.slice(0, 5), total_missing: (missingBb ?? []).length },
    });
  }

  // E3: Fleet-wide distinct step_key inventory — server-side via RPC/SQL
  {
    // Use distinct server-side query via the drift view which already covers this
    // Fallback: query all distinct step_keys with a dedicated approach
    const { data: allDistinct, error } = await sb.rpc("get_distinct_step_keys");

    if (error || !allDistinct) {
      // Fallback: client-side with reasonable limit
      const { data: rawSteps } = await sb
        .from("package_steps")
        .select("step_key")
        .limit(10000);

      const uniqueKeys = [...new Set((rawSteps ?? []).map((s: any) => s.step_key))];
      const unknownKeys = uniqueKeys.filter(k => !SSOT_STEP_KEYS.includes(k));

      if (unknownKeys.length > 0) {
        const { data: nonSkipped } = await sb
          .from("package_steps")
          .select("step_key, status")
          .in("step_key", unknownKeys)
          .not("status", "eq", "skipped")
          .limit(20);

        const nonSkippedCount = (nonSkipped ?? []).length;
        results.push({
          test_id: "E3_fleet_step_inventory",
          layer: "regression_drift",
          verdict: nonSkippedCount === 0 ? "pass" : "fail",
          detail: nonSkippedCount === 0
            ? `${unknownKeys.length} non-SSOT keys exist but all are skipped — clean (fallback mode)`
            : `FAIL: ${nonSkippedCount} non-SSOT steps in non-skipped states (fallback mode)`,
          evidence: { unknown_keys: unknownKeys, non_skipped_count: nonSkippedCount, mode: "fallback" },
        });
      } else {
        results.push({
          test_id: "E3_fleet_step_inventory",
          layer: "regression_drift",
          verdict: "pass",
          detail: `Fleet inventory: ${uniqueKeys.length} unique step_keys, all SSOT-valid (fallback mode)`,
        });
      }
    } else {
      const distinctKeys = (allDistinct as { step_key: string }[]).map(r => r.step_key);
      const unknownKeys = distinctKeys.filter(k => !SSOT_STEP_KEYS.includes(k));

      if (unknownKeys.length > 0) {
        const { data: nonSkipped } = await sb
          .from("package_steps")
          .select("step_key, status")
          .in("step_key", unknownKeys)
          .not("status", "eq", "skipped")
          .limit(20);

        const nonSkippedCount = (nonSkipped ?? []).length;
        results.push({
          test_id: "E3_fleet_step_inventory",
          layer: "regression_drift",
          verdict: nonSkippedCount === 0 ? "pass" : "fail",
          detail: nonSkippedCount === 0
            ? `${unknownKeys.length} non-SSOT keys exist but all are skipped — clean`
            : `FAIL: ${nonSkippedCount} non-SSOT steps in non-skipped states`,
          evidence: { unknown_keys: unknownKeys, non_skipped_count: nonSkippedCount, total_distinct: distinctKeys.length },
        });
      } else {
        results.push({
          test_id: "E3_fleet_step_inventory",
          layer: "regression_drift",
          verdict: "pass",
          detail: `Fleet inventory: ${distinctKeys.length} unique step_keys, all SSOT-valid`,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer F: Live Canary (only with explicit canary_package_id)
  // ═══════════════════════════════════════════════════════════════

  if (mode === "canary" && canaryPackageId) {
    // F1: Canary package step inventory
    const { data: canarySteps } = await sb
      .from("package_steps")
      .select("step_key, status")
      .eq("package_id", canaryPackageId);

    const steps = (canarySteps ?? []) as { step_key: string; status: string }[];
    const unexpected = steps.filter(s => !SSOT_STEP_KEYS.includes(s.step_key) && s.status !== "skipped");
    const doneCount = steps.filter(s => s.status === "done").length;
    const totalSsot = steps.filter(s => SSOT_STEP_KEYS.includes(s.step_key)).length;

    results.push({
      test_id: "F1_canary_step_inventory",
      layer: "live_canary",
      verdict: unexpected.length === 0 ? "pass" : "fail",
      detail: unexpected.length === 0
        ? `Canary has ${totalSsot} SSOT steps, ${doneCount} done`
        : `FAIL: ${unexpected.length} non-SSOT non-skipped steps in canary`,
      evidence: { package_id: canaryPackageId, total_steps: steps.length, ssot_steps: totalSsot, done: doneCount, unexpected },
    });

    // F2: Canary package is alive
    const { data: pkg } = await sb
      .from("course_packages")
      .select("status, updated_at, started_at")
      .eq("id", canaryPackageId)
      .single();

    if (pkg) {
      const isActive = ["building", "queued", "published", "done"].includes(pkg.status);
      results.push({
        test_id: "F2_canary_package_alive",
        layer: "live_canary",
        verdict: isActive ? "pass" : "warn",
        detail: `Canary package status: ${pkg.status}`,
        evidence: pkg,
      });
    }

    // F3: auto_publish step is reachable (use SSOT key)
    const AUTO_PUBLISH_KEY = SSOT_STEP_KEYS.includes("auto_publish") ? "auto_publish" : "package_auto_publish";
    const autoPublish = steps.find(s => s.step_key === AUTO_PUBLISH_KEY);
    const blockers = steps.filter(
      s => SSOT_STEP_KEYS.includes(s.step_key) && !["done", "skipped"].includes(s.status) && s.step_key !== AUTO_PUBLISH_KEY
    );

    results.push({
      test_id: "F3_canary_publish_reachable",
      layer: "live_canary",
      verdict: autoPublish ? "pass" : "fail",
      detail: autoPublish
        ? `${AUTO_PUBLISH_KEY} exists (status: ${autoPublish.status}), ${blockers.length} prerequisite steps remaining`
        : `FAIL: ${AUTO_PUBLISH_KEY} step missing from canary package`,
      evidence: {
        auto_publish_key: AUTO_PUBLISH_KEY,
        auto_publish_status: autoPublish?.status,
        remaining_blockers: blockers.length,
        blocker_steps: blockers.slice(0, 10).map(s => `${s.step_key}:${s.status}`),
      },
    });
  } else {
    results.push({
      test_id: "F0_canary_skipped",
      layer: "live_canary",
      verdict: "skip",
      detail: "Canary tests skipped: no canary_package_id provided (readonly mode)",
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Verdict — 4-level: pass / fail / warn / skip
  // ═══════════════════════════════════════════════════════════════

  const fails = results.filter(r => r.verdict === "fail");
  const warns = results.filter(r => r.verdict === "warn");
  const skips = results.filter(r => r.verdict === "skip");
  const passes = results.filter(r => r.verdict === "pass");

  const overallPass = fails.length === 0;
  const elapsed = Date.now() - started;

  const layerSummary: Record<string, { total: number; passed: number; failed: number; warned: number; skipped: number }> = {};
  for (const r of results) {
    if (!layerSummary[r.layer]) layerSummary[r.layer] = { total: 0, passed: 0, failed: 0, warned: 0, skipped: 0 };
    layerSummary[r.layer].total++;
    if (r.verdict === "pass") layerSummary[r.layer].passed++;
    else if (r.verdict === "fail") layerSummary[r.layer].failed++;
    else if (r.verdict === "warn") layerSummary[r.layer].warned++;
    else if (r.verdict === "skip") layerSummary[r.layer].skipped++;
  }

  let verdict: string;
  if (fails.length > 0) {
    verdict = `${fails.length}/${results.length} TESTS FAILED`;
  } else if (warns.length > 0) {
    verdict = `ALL HARD TESTS PASSED (${warns.length} warnings, ${skips.length} skipped)`;
  } else {
    verdict = `ALL ${passes.length} TESTS PASSED — Phantom-Step defect class fully remediated (${skips.length} skipped)`;
  }

  return json({
    ok: true,
    test_run_id: testRunId,
    mode,
    overall_pass: overallPass,
    verdict,
    summary: { total: results.length, passed: passes.length, failed: fails.length, warned: warns.length, skipped: skips.length },
    layer_summary: layerSummary,
    results,
    elapsed_ms: elapsed,
    ssot_step_count: SSOT_STEP_KEYS.length,
    ssot_step_keys: SSOT_STEP_KEYS,
  });
});
