import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { canonicalStepKey } from "../_shared/step-keys.ts";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import {
  getSchedulerCaps,
  computeAdaptiveWip,
  countGlobalInFlight,
  countPackageInFlight,
  getNeedsRegenCount,
  selectTargets,
  computeFairShareBatch,
  countLeasedPackages,
} from "../_shared/learning-content-scheduler.ts";
import {
  neutralizeStaleTransientFailed,
  reviveLearningContentStepIfDead,
} from "../_shared/learning-content-revive.ts";

/**
 * package-generate-learning-content — SSOT Dispatcher (v9 Adaptive Throughput)
 *
 * Fair, artifact-based scheduling with adaptive batch sizing:
 *   1. Adaptive global WIP throttle (fail-rate aware)
 *   2. Fair-share batch sizing across leased packages
 *   3. Per-package cap (prevents hotspotting)
 *   4. "DONE" ONLY when needs_regen === 0 (artifact truth)
 *   5. Idle lease release when no work dispatchable
 *   6. tier1_failed → reject stale content_versions before dispatching
 */

const STAGGER_MS = 100; // reduced from 150ms for faster dispatch

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

// ═══════════════════════════════════════════════════════════════
// Reject stale content_versions for tier1_failed lessons
// ═══════════════════════════════════════════════════════════════

async function rejectStaleVersionsForTier1Failed(
  // deno-lint-ignore no-explicit-any
  sb: any, courseId: string,
): Promise<number> {
  const { data: mods } = await sb
    .from("modules").select("id").eq("course_id", courseId);
  const moduleIds = (mods ?? []).map((m: { id: string }) => m.id);
  if (moduleIds.length === 0) return 0;

  const { data: failedLessons } = await sb
    .from("lessons").select("id")
    .in("module_id", moduleIds)
    .eq("qc_status", "tier1_failed");
  const failedIds = (failedLessons ?? []).map((l: { id: string }) => l.id);
  if (failedIds.length === 0) return 0;

  let rejected = 0;
  for (let i = 0; i < failedIds.length; i += 200) {
    const chunk = failedIds.slice(i, i + 200);
    const { data: stale } = await sb
      .from("content_versions")
      .select("id")
      .in("lesson_id", chunk)
      .neq("status", "rejected");

    if (stale && stale.length > 0) {
      const vIds = stale.map((v: { id: string }) => v.id);
      await sb.from("content_versions")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .in("id", vIds);
      rejected += vIds.length;
    }
  }
  return rejected;
}

// ═══════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("package-generate-learning-content", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId || !courseId) {
    return json({ error: "Missing package_id, curriculum_id, or course_id" }, 400);
  }

  // ── Prereq check ──
  if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
  }

  // ── Reject stale content_versions for tier1_failed lessons ──
  const rejectedCount = await rejectStaleVersionsForTier1Failed(sb, courseId);
  if (rejectedCount > 0) {
    console.log(`[dispatcher] Rejected ${rejectedCount} stale content_versions for tier1_failed lessons`);
  }

  // ════════════════════════════════════════════════════════════════
  // SSOT Adaptive Scheduler: fair-share, capped, fail-rate aware
  // ════════════════════════════════════════════════════════════════

  const caps = getSchedulerCaps();
  const { effectiveWip, failRate } = await computeAdaptiveWip(sb, caps.globalWipMax);
  const globalInFlight = await countGlobalInFlight(sb);
  const freeSlots = Math.max(0, effectiveWip - globalInFlight);

  // Fair-share: count how many packages hold leases for even distribution
  const leasedPackageCount = await countLeasedPackages(sb);

  console.log(
    `[dispatcher] WIP: base=${caps.globalWipMax} effective=${effectiveWip} inFlight=${globalInFlight} free=${freeSlots} failRate=${failRate.toFixed(2)} leasedPkgs=${leasedPackageCount}`
  );

  // ── Artifact-based DONE gate ──
  const needsRegen = await getNeedsRegenCount(sb, packageId);

  if (needsRegen === 0) {
    const pkgInFlight = await countPackageInFlight(sb, packageId);
    if (pkgInFlight > 0) {
      return json({
        ok: true,
        batch_complete: false,
        message: `⏳ ${pkgInFlight} lesson jobs still active — waiting.`,
        active_lesson_jobs: pkgInFlight,
        needs_regen: 0,
      });
    }

    return json({
      ok: true,
      batch_complete: true,
      message: `✅ All lessons have valid content (needs_regen=0).`,
      needs_regen: 0,
      completion_gate: { needs_regen: 0, active_jobs: 0 },
    });
  }

  // ── Capacity check ──
  if (freeSlots <= 0) {
    return json({
      ok: true,
      batch_complete: false,
      message: `🔒 No free WIP slots (effective=${effectiveWip}, inFlight=${globalInFlight}).`,
      needs_regen: needsRegen,
      dispatched: 0,
      reason: "no_free_slots",
    });
  }

  // ── Per-package cap with fair-share ──
  const pkgInFlight = await countPackageInFlight(sb, packageId);
  const pkgFree = Math.max(0, caps.perPackageMax - pkgInFlight);

  if (pkgFree <= 0) {
    return json({
      ok: true,
      batch_complete: false,
      message: `🔒 Per-package cap reached (max=${caps.perPackageMax}, inFlight=${pkgInFlight}).`,
      needs_regen: needsRegen,
      dispatched: 0,
      reason: "per_package_cap",
    });
  }

  // ── Adaptive batch: fair-share across leased packages ──
  const fairBatch = computeFairShareBatch({
    needsRegen,
    freeGlobalSlots: freeSlots,
    leasedPackageCount,
    perPackageMax: caps.perPackageMax,
  });
  const take = Math.min(fairBatch, pkgFree, caps.dispatchBatchMax);
  const targets = await selectTargets(sb, packageId, take);

  if (targets.length === 0) {
    // ── Liveness Guard: needsRegen > 0 but no dispatchable targets ──
    const neutralized = await neutralizeStaleTransientFailed(sb, packageId, 120);
    if (neutralized > 0) {
      console.warn(
        `[dispatcher] LIVENESS_GUARD: neutralized ${neutralized} stale transient-failed jobs for ${packageId.slice(0, 8)}`,
      );
      await reviveLearningContentStepIfDead(sb, packageId, needsRegen);
      return json({
        ok: true,
        batch_complete: false,
        message: `♻️ Neutralized ${neutralized} stale failed jobs, step revived for redispatch.`,
        needs_regen: needsRegen,
        dispatched: 0,
        neutralized,
        liveness_guard: true,
      });
    }

    return json({
      ok: true,
      batch_complete: false,
      message: `⚠️ needs_regen=${needsRegen} but no targets returned — possible race.`,
      needs_regen: needsRegen,
      dispatched: 0,
    });
  }

  // ── Enqueue lesson jobs via SSOT enqueueJob helper ──
  let enqueued = 0;
  let deduped = 0;
  const errors: string[] = [];
  const now = Date.now();

  // Update dispatch progress in package_steps.meta
  try {
    const { data: stepRow } = await sb
      .from("package_steps")
      .select("id, meta")
      .eq("package_id", packageId)
      .eq("step_key", "generate_learning_content")
      .maybeSingle();
    if (stepRow) {
      await sb.from("package_steps").update({
        meta: {
          ...(stepRow.meta ?? {}),
          dispatcher_mode: true,
          needs_regen: needsRegen,
          enqueue_batch: targets.length,
          fair_share_batch: fairBatch,
          effective_wip: effectiveWip,
          fail_rate: failRate,
          leased_packages: leasedPackageCount,
          global_in_flight: globalInFlight,
          pkg_in_flight: pkgInFlight,
          last_dispatch_at: new Date().toISOString(),
        },
      }).eq("id", stepRow.id);
    }
  } catch { /* non-critical */ }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const result = await enqueueJob(sb, {
        job_type: "lesson_generate_content",
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          certification_id: certificationId,
          lesson_id: t.id,
          step_key: canonicalStepKey(t.step),
        },
        batch_cursor: { lesson_id: t.id, step_key: canonicalStepKey(t.step) },
        priority: 12,
        run_after: new Date(now + i * STAGGER_MS).toISOString(),
        max_attempts: 5,
      });
      if (result.revived) {
        console.log(`[dispatcher] Revived job for ${t.id.slice(0, 8)}:${canonicalStepKey(t.step)}`);
      }
      enqueued++;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (msg.includes("DEDUP") || msg.includes("duplicate") || msg.includes("23505")) {
        deduped++;
      } else if (msg.includes("PACKAGE_NOT_EXECUTABLE")) {
        return json({ ok: false, error: "Package not executable", enqueued, deduped }, 409);
      } else {
        errors.push(`${t.id.slice(0, 8)}: ${msg.slice(0, 100)}`);
      }
    }
  }

  console.log(
    `[dispatcher] ${packageId.slice(0, 8)}: enqueued=${enqueued} deduped=${deduped} needsRegen=${needsRegen} fairBatch=${fairBatch} errors=${errors.length}`
  );

  return json({
    ok: true,
    batch_complete: false,
    message: `📤 ${enqueued} jobs enqueued (${deduped} deduped), ${needsRegen} needs_regen, fair=${fairBatch}.`,
    needs_regen: needsRegen,
    enqueued,
    deduped,
    effective_wip: effectiveWip,
    fair_share_batch: fairBatch,
    leased_packages: leasedPackageCount,
    fail_rate: failRate,
    errors: errors.length > 0 ? errors : undefined,
  });
});
