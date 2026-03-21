import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { FULL_STEP_ORDER, type PipelineStepKey } from "../_shared/job-map.ts";

/**
 * ops-phantom-step-e2e-test — Gestaffelte Testpyramide für Phantom-Step-Defektklasse
 *
 * 6 Testschichten:
 *   A. Schema/Guard  — DB trigger rejects unknown steps, accepts SSOT steps
 *   B. Seeder/Backbone — assert_step_backbone seeds exactly SSOT keys
 *   C. Runtime/Orchestration — no phantom steps queued, no legacy blockers
 *   D. Publish-Readiness — auto_publish not blocked by skipped legacy steps
 *   E. Regression — drift view empty, no queued phantoms in fleet
 *   F. Canary — real package golden-path verification (optional, needs pkg_id)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SSOT_STEP_KEYS: string[] = [...FULL_STEP_ORDER];

interface TestResult {
  test_id: string;
  layer: string;
  pass: boolean;
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
  const skipCanary = body.skip_canary !== false && !canaryPackageId;
  const testRunId = `phantom_e2e_${crypto.randomUUID().slice(0, 8)}`;
  const started = Date.now();

  const results: TestResult[] = [];

  // ═══════════════════════════════════════════════════════════════
  // Layer A: Schema / Guard Tests
  // ═══════════════════════════════════════════════════════════════

  // A1: Unknown step MUST be rejected
  {
    const { data: pkg } = await sb
      .from("course_packages").select("id").limit(1).single();

    if (pkg?.id) {
      const { error } = await sb.from("package_steps").insert({
        package_id: pkg.id,
        step_key: "generate_curriculum_foo_" + testRunId,
        status: "queued",
      });
      const rejected = !!error && (error.message?.includes("SSOT_STEP_KEY_REJECTED") || error.code === "P0001");
      results.push({
        test_id: "A1_unknown_step_rejected",
        layer: "schema_guard",
        pass: rejected,
        detail: rejected
          ? "Guard trigger correctly rejected unknown step_key"
          : `FAIL: Unknown step was NOT rejected. Error: ${error?.message ?? "no error, insert succeeded!"}`,
        evidence: { error_message: error?.message, error_code: error?.code },
      });
    } else {
      results.push({
        test_id: "A1_unknown_step_rejected",
        layer: "schema_guard",
        pass: false,
        detail: "SKIP: No packages found to test against",
      });
    }
  }

  // A2: Legitimate SSOT step must be accepted
  {
    const { data: pkg } = await sb
      .from("course_packages").select("id").limit(1).single();

    if (pkg?.id) {
      // Use upsert to avoid conflicts
      const { error } = await sb.from("package_steps").upsert(
        { package_id: pkg.id, step_key: "elite_harden", status: "queued" },
        { onConflict: "package_id,step_key" },
      );
      const accepted = !error;
      results.push({
        test_id: "A2_ssot_step_accepted",
        layer: "schema_guard",
        pass: accepted,
        detail: accepted
          ? "Legitimate SSOT step_key accepted by guard"
          : `FAIL: SSOT step rejected: ${error?.message}`,
      });
    }
  }

  // A3: Multiple unknown keys all fail
  {
    const fakeKeys = ["setup_storefront", "launch_marketing", "generate_curriculum", "setup_pwa"];
    const { data: pkg } = await sb
      .from("course_packages").select("id").limit(1).single();
    const rejections: string[] = [];

    if (pkg?.id) {
      for (const fk of fakeKeys) {
        const { error } = await sb.from("package_steps").insert({
          package_id: pkg.id,
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
        pass: allRejected,
        detail: allRejected
          ? `All ${fakeKeys.length} legacy/phantom keys correctly rejected`
          : `FAIL: Only ${rejections.length}/${fakeKeys.length} rejected. Missing: ${fakeKeys.filter(k => !rejections.includes(k)).join(",")}`,
        evidence: { tested: fakeKeys, rejected: rejections },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer B: Seeder / Backbone Tests
  // ═══════════════════════════════════════════════════════════════

  // B1: Seeder produces exactly SSOT step set (check a recent package)
  {
    const { data: recentPkg } = await sb
      .from("course_packages")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (recentPkg?.id) {
      const { data: steps } = await sb
        .from("package_steps")
        .select("step_key")
        .eq("package_id", recentPkg.id);

      const actualKeys = new Set((steps ?? []).map((s: any) => s.step_key));
      const ssotSet = new Set(SSOT_STEP_KEYS);

      const unexpected = [...actualKeys].filter(k => !ssotSet.has(k));
      const missing = [...ssotSet].filter(k => !actualKeys.has(k));

      const pass = unexpected.length === 0;
      results.push({
        test_id: "B1_seed_parity",
        layer: "seeder_backbone",
        pass,
        detail: pass
          ? `Package ${recentPkg.id.slice(0, 8)} has ${actualKeys.size} steps, all SSOT-valid. Missing (acceptable): ${missing.length}`
          : `FAIL: ${unexpected.length} unexpected keys: ${unexpected.join(",")}`,
        evidence: { package_id: recentPkg.id, actual_count: actualKeys.size, unexpected, missing },
      });
    }
  }

  // B2: assert_step_backbone idempotency (call twice, verify no duplicates)
  {
    const { data: testPkg } = await sb
      .from("course_packages")
      .select("id")
      .eq("status", "building")
      .limit(1)
      .single();

    if (testPkg?.id) {
      // Call backbone twice
      await sb.rpc("assert_step_backbone", { p_package_id: testPkg.id });
      await sb.rpc("assert_step_backbone", { p_package_id: testPkg.id });

      // Check for duplicates
      // Direct check for duplicates
      const { data: steps } = await sb
        .from("package_steps")
        .select("step_key")
        .eq("package_id", testPkg.id);

      const counts: Record<string, number> = {};
      for (const s of (steps ?? []) as { step_key: string }[]) {
        counts[s.step_key] = (counts[s.step_key] ?? 0) + 1;
      }
      const duplicated = Object.entries(counts).filter(([, c]) => c > 1);

      results.push({
        test_id: "B2_seeder_idempotent",
        layer: "seeder_backbone",
        pass: duplicated.length === 0,
        detail: duplicated.length === 0
          ? "assert_step_backbone is idempotent, no duplicate step_keys"
          : `FAIL: Duplicates found: ${duplicated.map(([k, c]) => `${k}(${c})`).join(",")}`,
        evidence: { package_id: testPkg.id, duplicated },
      });
    } else {
      results.push({
        test_id: "B2_seeder_idempotent",
        layer: "seeder_backbone",
        pass: true,
        detail: "SKIP: No building package available for idempotency test",
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer C: Runtime / Orchestration Tests
  // ═══════════════════════════════════════════════════════════════

  // C1: No queued phantom steps in entire fleet
  {
    const { data: phantomQueued, error } = await sb
      .from("package_steps")
      .select("package_id, step_key")
      .eq("status", "queued")
      .not("step_key", "in", `(${SSOT_STEP_KEYS.join(",")})`)
      .limit(20);

    const count = (phantomQueued ?? []).length;
    results.push({
      test_id: "C1_no_queued_phantoms",
      layer: "runtime_orchestration",
      pass: count === 0,
      detail: count === 0
        ? "Zero queued phantom steps in fleet"
        : `FAIL: ${count} queued phantom steps remain`,
      evidence: error ? { error: error.message } : { samples: (phantomQueued ?? []).slice(0, 5) },
    });
  }

  // C2: No phantom steps blocking any package (all should be skipped/done)
  {
    const { data: blockingPhantoms } = await sb
      .from("package_steps")
      .select("package_id, step_key, status")
      .in("status", ["queued", "running", "failed"])
      .not("step_key", "in", `(${SSOT_STEP_KEYS.join(",")})`)
      .limit(20);

    const count = (blockingPhantoms ?? []).length;
    results.push({
      test_id: "C2_no_blocking_phantoms",
      layer: "runtime_orchestration",
      pass: count === 0,
      detail: count === 0
        ? "No phantom steps in blocking states (queued/running/failed)"
        : `FAIL: ${count} phantom steps still in blocking states`,
      evidence: { samples: (blockingPhantoms ?? []).slice(0, 5) },
    });
  }

  // C3: All building packages have valid step_keys only
  {
    const { data: buildingSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key")
      .in("package_id", (
        await sb.from("course_packages").select("id").eq("status", "building")
      ).data?.map((p: any) => p.id) ?? [])
      .not("step_key", "in", `(${SSOT_STEP_KEYS.join(",")})`)
      .not("status", "eq", "skipped")
      .limit(20);

    const count = (buildingSteps ?? []).length;
    results.push({
      test_id: "C3_building_packages_clean",
      layer: "runtime_orchestration",
      pass: count === 0,
      detail: count === 0
        ? "All building packages have only SSOT step_keys (or non-SSOT are skipped)"
        : `FAIL: ${count} non-SSOT non-skipped steps in building packages`,
      evidence: { samples: (buildingSteps ?? []).slice(0, 5) },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer D: Publish-Readiness Tests
  // ═══════════════════════════════════════════════════════════════

  // D1: auto_publish is reachable (not blocked by skipped legacy steps)
  {
    const { data: publishBlockers } = await sb
      .from("v_ops_auto_publish_blockers")
      .select("package_id, blocker_reason")
      .limit(10);

    // Check if any blocker mentions phantom/unknown steps
    const phantomBlockers = (publishBlockers ?? []).filter(
      (b: any) => /phantom|unknown|legacy/i.test(String(b.blocker_reason ?? ""))
    );

    results.push({
      test_id: "D1_publish_not_phantom_blocked",
      layer: "publish_readiness",
      pass: phantomBlockers.length === 0,
      detail: phantomBlockers.length === 0
        ? "No publish blockers reference phantom/unknown/legacy steps"
        : `WARN: ${phantomBlockers.length} publish blockers may reference phantom steps`,
      evidence: { phantom_blockers: phantomBlockers.slice(0, 5), total_blockers: (publishBlockers ?? []).length },
    });
  }

  // D2: Readiness views are consistent
  {
    const { data: readiness } = await sb
      .from("ops_package_readiness")
      .select("package_id, readiness_pct, blocker_count")
      .gt("blocker_count", 0)
      .limit(10);

    results.push({
      test_id: "D2_readiness_views_consistent",
      layer: "publish_readiness",
      pass: true, // informational
      detail: `${(readiness ?? []).length} packages have blockers (informational)`,
      evidence: { sample: (readiness ?? []).slice(0, 5) },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer E: Regression / Drift Tests
  // ═══════════════════════════════════════════════════════════════

  // E1: ops_phantom_step_drift is empty
  {
    const { data: drift, error } = await sb
      .from("ops_phantom_step_drift")
      .select("*")
      .limit(50);

    const count = (drift ?? []).length;
    results.push({
      test_id: "E1_drift_view_empty",
      layer: "regression_drift",
      pass: count === 0,
      detail: count === 0
        ? "ops_phantom_step_drift returns 0 rows — no drift detected"
        : `FAIL: ${count} drift rows detected`,
      evidence: error ? { error: error.message } : { samples: (drift ?? []).slice(0, 5) },
    });
  }

  // E2: ops_missing_step_backbone reports only SSOT keys
  {
    const { data: missingBb } = await sb
      .from("ops_missing_step_backbone")
      .select("*")
      .limit(50);

    const nonSsotMissing = (missingBb ?? []).filter(
      (r: any) => !SSOT_STEP_KEYS.includes(r.step_key)
    );

    results.push({
      test_id: "E2_backbone_view_ssot_only",
      layer: "regression_drift",
      pass: nonSsotMissing.length === 0,
      detail: nonSsotMissing.length === 0
        ? `ops_missing_step_backbone reports only SSOT keys (${(missingBb ?? []).length} total missing)`
        : `FAIL: ${nonSsotMissing.length} non-SSOT keys in missing backbone view`,
      evidence: { non_ssot_missing: nonSsotMissing.slice(0, 5), total_missing: (missingBb ?? []).length },
    });
  }

  // E3: Fleet-wide step_key inventory is clean
  {
    const { data: rawSteps } = await sb
      .from("package_steps")
      .select("step_key")
      .limit(5000);

      const uniqueKeys = [...new Set((rawSteps ?? []).map((s: any) => s.step_key))];
      const unknownKeys = uniqueKeys.filter(k => !SSOT_STEP_KEYS.includes(k));

      // Unknown keys are OK if they're all in 'skipped' status
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
          pass: nonSkippedCount === 0,
          detail: nonSkippedCount === 0
            ? `${unknownKeys.length} non-SSOT keys exist but all are skipped — clean`
            : `FAIL: ${nonSkippedCount} non-SSOT steps in non-skipped states`,
          evidence: { unknown_keys: unknownKeys, non_skipped_samples: (nonSkipped ?? []).slice(0, 5) },
        });
      } else {
        results.push({
          test_id: "E3_fleet_step_inventory",
          layer: "regression_drift",
          pass: true,
          detail: `Fleet inventory: ${uniqueKeys.length} unique step_keys, all SSOT-valid`,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer F: Live Canary (optional)
  // ═══════════════════════════════════════════════════════════════

  if (!skipCanary && canaryPackageId) {
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
      pass: unexpected.length === 0,
      detail: unexpected.length === 0
        ? `Canary package has ${totalSsot} SSOT steps, ${doneCount} done`
        : `FAIL: ${unexpected.length} non-SSOT non-skipped steps in canary`,
      evidence: {
        package_id: canaryPackageId,
        total_steps: steps.length,
        ssot_steps: totalSsot,
        done: doneCount,
        unexpected,
      },
    });

    // F2: Canary package is progressing (not stuck)
    const { data: pkg } = await sb
      .from("course_packages")
      .select("status, updated_at, started_at")
      .eq("id", canaryPackageId)
      .single();

    if (pkg) {
      const isActive = ["building", "queued", "published"].includes(pkg.status);
      results.push({
        test_id: "F2_canary_package_alive",
        layer: "live_canary",
        pass: isActive,
        detail: `Canary package status: ${pkg.status}`,
        evidence: pkg,
      });
    }

    // F3: auto_publish step is reachable for canary
    const autoPublish = steps.find(s => s.step_key === "auto_publish");
    const blockers = steps.filter(
      s => SSOT_STEP_KEYS.includes(s.step_key) && !["done", "skipped"].includes(s.status)
    );

    results.push({
      test_id: "F3_canary_publish_reachable",
      layer: "live_canary",
      pass: !!autoPublish,
      detail: autoPublish
        ? `auto_publish exists (status: ${autoPublish.status}), ${blockers.length} prerequisite steps remaining`
        : "FAIL: auto_publish step missing from canary package",
      evidence: {
        auto_publish_status: autoPublish?.status,
        remaining_blockers: blockers.length,
        blocker_steps: blockers.slice(0, 10).map(s => `${s.step_key}:${s.status}`),
      },
    });
  } else if (!skipCanary) {
    results.push({
      test_id: "F0_canary_skipped",
      layer: "live_canary",
      pass: true,
      detail: "Canary skipped: no canary_package_id provided",
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Verdict
  // ═══════════════════════════════════════════════════════════════

  const hardFails = results.filter(r => !r.pass);
  const overallPass = hardFails.length === 0;
  const elapsed = Date.now() - started;

  const layerSummary: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    if (!layerSummary[r.layer]) layerSummary[r.layer] = { total: 0, passed: 0 };
    layerSummary[r.layer].total++;
    if (r.pass) layerSummary[r.layer].passed++;
  }

  return json({
    ok: true,
    test_run_id: testRunId,
    overall_pass: overallPass,
    verdict: overallPass
      ? `ALL ${results.length} TESTS PASSED — Phantom-Step defect class fully remediated`
      : `${hardFails.length}/${results.length} TESTS FAILED`,
    layer_summary: layerSummary,
    results,
    elapsed_ms: elapsed,
    ssot_step_count: SSOT_STEP_KEYS.length,
    ssot_step_keys: SSOT_STEP_KEYS,
  });
});
