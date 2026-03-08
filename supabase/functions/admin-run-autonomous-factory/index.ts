import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * admin-run-autonomous-factory — Full autonomous pipeline:
 *   1. Detect ready curricula → intake queue
 *   2. Evaluate intake items (readiness + priority)
 *   3. Plan wave from evaluated items (if < 2 active waves)
 *   4. Optionally activate new wave
 *   5. Run production supervisor
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  // Support both admin auth and internal cron calls
  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const isInternal = edgeSecret !== "" && internalSecret === edgeSecret;

  if (!isInternal) {
    const auth = await validateAuth(req, true);
    if (auth.error || !auth.isAdmin) {
      return json(401, { error: auth.error || "Admin required" }, origin);
    }
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result: Record<string, unknown> = {
    ok: true,
    detected: null,
    evaluated: null,
    planned_wave: null,
    activated_wave: null,
    supervisor: null,
  };

  // Load autonomy policy
  const { data: policy } = await sb
    .from("factory_autonomy_policies")
    .select("*")
    .eq("policy_key", "factory_default")
    .maybeSingle();

  if (!policy?.is_enabled) {
    return json(200, { ok: true, skipped: true, reason: "autonomy_disabled" }, origin);
  }

  // Step 1: Detect new ready curricula
  if (policy.auto_detect) {
    const { data, error } = await sb.rpc("detect_ready_curricula_for_factory", {
      p_limit: policy.max_new_curricula_per_day ?? 20,
    });
    result.detected = error ? { error: error.message } : data;
  }

  // Step 2: Evaluate detected items
  if (policy.auto_plan) {
    const { data, error } = await sb.rpc("evaluate_factory_intake_items", {
      p_limit: policy.max_new_curricula_per_day ?? 20,
    });
    result.evaluated = error ? { error: error.message } : data;
  }

  // Step 3: Check active wave count before planning
  const { count: activeWaves } = await sb
    .from("production_waves")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  // Safety: also check budget guard before planning
  let budgetBlocked = false;
  try {
    const { data: budget } = await sb.rpc("check_ai_budget_guard", {
      p_wave_id: null,
      p_package_id: null,
      p_policy_key: "factory_default",
    });
    if ((budget as any)?.blocked) {
      budgetBlocked = true;
      result.budget_blocked = true;
    }
  } catch {
    // Budget guard not critical for planning
  }

  // Safety: check failed jobs threshold
  const { count: failedJobs1h } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("updated_at", new Date(Date.now() - 3600_000).toISOString());

  const tooManyFailures = (failedJobs1h ?? 0) > 50;
  if (tooManyFailures) {
    result.safety_stop = "too_many_failed_jobs";
  }

  if (
    (activeWaves ?? 0) < 2 &&
    policy.auto_plan &&
    !budgetBlocked &&
    !tooManyFailures
  ) {
    const { data: planned, error: planErr } = await sb.rpc("plan_factory_wave_from_intake", {
      p_limit: policy.max_auto_wave_size ?? 20,
      p_name: null,
    });

    result.planned_wave = planErr ? { error: planErr.message } : planned;

    const plannedWaveId = (planned as any)?.wave_id;
    const plannedItems = (planned as any)?.planned_items ?? 0;

    if (plannedWaveId && plannedItems > 0 && policy.auto_activate_wave) {
      // Activate via supervisor
      try {
        const activateHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (edgeSecret) {
          activateHeaders["x-internal-secret"] = edgeSecret;
        } else {
          activateHeaders["Authorization"] = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
        }
        const res = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-production-supervisor`,
          {
            method: "POST",
            headers: activateHeaders,
            body: JSON.stringify({
              action: "activate",
              wave_id: plannedWaveId,
            }),
          },
        );
        result.activated_wave = await res.json().catch(() => ({}));
      } catch (e) {
        result.activated_wave = { error: String(e) };
      }
    }
  } else {
    result.planned_wave = {
      skipped: true,
      active_waves: activeWaves ?? 0,
      budget_blocked: budgetBlocked,
      too_many_failures: tooManyFailures,
    };
  }

  // Step 4: Run production supervisor
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (isInternal && edgeSecret) {
      headers["x-internal-secret"] = edgeSecret;
    } else {
      headers["Authorization"] = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
    }

    const supRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-run-production-supervisor`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source: "autonomous_factory" }),
      },
    );
    result.supervisor = await supRes.json().catch(() => ({}));
  } catch (e) {
    result.supervisor = { error: String(e) };
  }

  return json(200, result, origin);
});
