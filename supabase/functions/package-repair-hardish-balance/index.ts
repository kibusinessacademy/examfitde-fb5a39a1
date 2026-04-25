// package-repair-hardish-balance
//
// Repairs the "hardish" balance gap (hard + apply/analyze/evaluate/create) for a
// package's exam pool. Strategy:
//   1. PROMOTE: Move existing draft/tier1_passed questions matching the
//      hardish profile to status='approved' (no LLM, non-destructive).
//   2. NO-EFFECT: If no candidates exist, fail step with clear LLM-fill reason.
//
// Gated behind admin_settings.heal_strategy_hardish_balance.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { markStepDone, markStepFailed } from "../_shared/steps.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const STEP_KEY = "repair_exam_pool_quality";

interface Payload {
  package_id?: string;
  curriculum_id?: string;
  current_hardish_pct?: number;
  target_hardish_pct?: number;
  gap_pct?: number;
  job_id?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let payload: Payload = {};
  try { payload = await req.json(); } catch { /* empty body OK */ }

  const packageId = payload.package_id;
  const curriculumId = payload.curriculum_id;

  if (!packageId || !curriculumId) {
    return json({ error: "missing_package_or_curriculum" }, 400);
  }

  // ── Toggle gate ────────────────────────────────────────────────
  const { data: setting } = await sb
    .from("admin_settings")
    .select("value")
    .eq("key", "heal_strategy_hardish_balance")
    .maybeSingle();

  const enabled = !!(setting?.value as Record<string, unknown> | null)?.["enabled"];
  if (!enabled) {
    console.log(`[hardish-balance] toggle disabled — exiting idempotently`);
    try {
      await markStepFailed(sb, {
        packageId,
        stepKey: STEP_KEY,
        err: { message: "HARDISH_HANDLER_DISABLED_BY_SETTING", __meta: { progress_delta: 0 } },
      });
    } catch (e) { console.warn(`[hardish-balance] markStepFailed failed: ${(e as Error).message}`); }
    return json({ ok: false, skipped: true, reason: "toggle_disabled" });
  }

  // ── Ensure step row exists ─────────────────────────────────────
  await sb.rpc("ensure_package_step", {
    p_package_id: packageId,
    p_step_key: STEP_KEY,
  });
  await sb.from("package_steps").update({
    started_at: new Date().toISOString(),
    status: "running",
  }).eq("package_id", packageId).eq("step_key", STEP_KEY).is("started_at", null);

  // ── 1. Find promotable hardish candidates ──────────────────────
  const { data: candidates, error: candErr } = await sb
    .from("exam_questions")
    .select("id")
    .eq("curriculum_id", curriculumId)
    .eq("difficulty", "hard")
    .in("cognitive_level", ["apply", "analyze", "evaluate", "create"])
    .neq("status", "approved")
    .or("qc_status.eq.tier1_passed,qc_status.eq.approved,review_state.eq.approved")
    .limit(500);

  if (candErr) {
    console.error(`[hardish-balance] candidate query failed: ${candErr.message}`);
    try {
      await markStepFailed(sb, {
        packageId, stepKey: STEP_KEY,
        err: { message: `HARDISH_QUERY_FAIL:${candErr.message}` },
      });
    } catch { /* swallow */ }
    return json({ error: candErr.message }, 500);
  }

  const candCount = candidates?.length ?? 0;
  console.log(`[hardish-balance] found ${candCount} promotable candidates for ${packageId}`);

  if (candCount === 0) {
    const reason = `HARDISH_NO_PROMOTABLE_QUESTIONS_current=${payload.current_hardish_pct}_target=${payload.target_hardish_pct}_require_llm_fill`;
    try {
      await markStepFailed(sb, {
        packageId, stepKey: STEP_KEY,
        err: { message: reason, __meta: { progress_delta: 0, no_progress: true } },
      });
    } catch { /* swallow */ }
    return json({
      ok: false, promoted: 0, reason,
      recommendation: "implement LLM-based difficulty fill or manual seed",
    });
  }

  // ── 2. Promote in batch ────────────────────────────────────────
  const ids = candidates!.map((c) => (c as { id: string }).id);
  const { error: promoteErr } = await sb
    .from("exam_questions")
    .update({
      status: "approved",
      qc_status: "approved",
      review_state: "approved",
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (promoteErr) {
    console.error(`[hardish-balance] promotion failed: ${promoteErr.message}`);
    try {
      await markStepFailed(sb, {
        packageId, stepKey: STEP_KEY,
        err: { message: `HARDISH_PROMOTE_FAIL:${promoteErr.message}` },
      });
    } catch { /* swallow */ }
    return json({ error: promoteErr.message }, 500);
  }

  console.log(`[hardish-balance] promoted ${candCount} questions for ${packageId}`);

  await markStepDone(sb, {
    packageId, stepKey: STEP_KEY,
    meta: {
      ok: "true",
      executed: true,
      action: "hardish_promotion",
      promoted_count: candCount,
      prev_hardish_pct: payload.current_hardish_pct,
      target_hardish_pct: payload.target_hardish_pct,
      progress_delta: candCount,
    },
  });

  return json({
    ok: true, promoted: candCount,
    prev_hardish_pct: payload.current_hardish_pct,
    target_hardish_pct: payload.target_hardish_pct,
  });
});
