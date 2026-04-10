import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { canonicalStepKey } from "../_shared/step-keys.ts";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import { resolveAvailableRoute } from "../_shared/llm/provider-load-balancer.ts";
import {
  getSchedulerCaps,
  computeAdaptiveWip,
  countGlobalInFlight,
  countPackageInFlight,
  getNeedsRegenCount,
  selectTargets,
  selectCompetencyTargets,
  computeFairShareBatch,
  countLeasedPackages,
} from "../_shared/learning-content-scheduler.ts";
import {
  neutralizeStaleTransientFailed,
  reviveLearningContentStepIfDead,
} from "../_shared/learning-content-revive.ts";

/**
 * package-generate-learning-content — SSOT Dispatcher (v10 Adaptive + Lease Release)
 *
 * Fair, artifact-based scheduling with adaptive batch sizing:
 *   1. Adaptive global WIP throttle (fail-rate aware)
 *   2. Fair-share batch sizing across leased packages
 *   3. Per-package cap (prevents hotspotting)
 *   4. "DONE" ONLY when needs_regen === 0 (artifact truth)
 *   5. **Idle lease release** on all non-dispatchable branches
 *   6. tier1_failed → reject stale content_versions before dispatching
 */

const STAGGER_MS = 30; // OPT-4: reduced from 100ms for +60% dispatch throughput

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

// prereqDone imported from _shared/prereq-done.ts

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
// Lease release + meta telemetry helpers
// ═══════════════════════════════════════════════════════════════

async function updateLearningContentStepMeta(
  // deno-lint-ignore no-explicit-any
  sb: any,
  packageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: stepRow, error: selErr } = await sb
      .from("package_steps")
      .select("id, meta")
      .eq("package_id", packageId)
      .eq("step_key", "generate_learning_content")
      .maybeSingle();

    if (selErr) {
      console.warn(`[dispatcher] updateStepMeta select failed for ${packageId.slice(0, 8)}: ${selErr.message}`);
      return;
    }
    if (!stepRow?.id) return;

    const { error: updErr } = await sb
      .from("package_steps")
      .update({
        meta: { ...(stepRow.meta ?? {}), ...patch },
        updated_at: new Date().toISOString(),
      })
      .eq("id", stepRow.id);

    if (updErr) {
      console.warn(`[dispatcher] updateStepMeta update failed for ${packageId.slice(0, 8)}: ${updErr.message}`);
    }
  } catch (e) {
    console.warn(
      `[dispatcher] updateStepMeta exception for ${packageId.slice(0, 8)}: ${(e as Error)?.message ?? String(e)}`,
    );
  }
}

async function releasePackageLease(
  // deno-lint-ignore no-explicit-any
  sb: any,
  packageId: string,
  reason: string,
  extraMeta: Record<string, unknown> = {},
): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1) Step meta first — survives even if delete fails transiently
  await updateLearningContentStepMeta(sb, packageId, {
    lease_released_at: nowIso,
    lease_release_reason: reason,
    dispatch_blocked_reason: extraMeta["dispatch_blocked_reason"] ?? null,
    ...extraMeta,
  });

  // 2) Release lease in package_leases (primary lease storage)
  try {
    const { error } = await sb.from("package_leases").delete().eq("package_id", packageId);
    if (error) {
      console.warn(`[dispatcher] release lease (package_leases) failed for ${packageId.slice(0, 8)}: ${error.message}`);
    }
  } catch (e) {
    console.warn(`[dispatcher] release lease exception for ${packageId.slice(0, 8)}: ${(e as Error)?.message ?? String(e)}`);
  }

  console.log(`[dispatcher] Lease released for ${packageId.slice(0, 8)} reason=${reason}`);
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

  // ── Route-aware health gate (load balancer) ──
  const route = await resolveAvailableRoute("competency_bundle");
  if (!route?.ok) {
    await updateLearningContentStepMeta(sb, packageId, {
      dispatch_blocked_reason: "all_candidates_on_cooldown",
      last_probe_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      batch_complete: false,
      fan_out_skipped: false,
      message: "No healthy provider route for competency_bundle, dispatch deferred.",
      deferred_by_health_gate: true,
    });
  }

  await updateLearningContentStepMeta(sb, packageId, {
    dispatcher_route_provider: route.provider,
    dispatcher_route_model: route.model,
    last_probe_at: new Date().toISOString(),
  });

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

  const leasedPackageCount = await countLeasedPackages(sb);

  console.log(
    `[dispatcher] WIP: base=${caps.globalWipMax} effective=${effectiveWip} inFlight=${globalInFlight} free=${freeSlots} failRate=${failRate.toFixed(2)} leasedPkgs=${leasedPackageCount}`
  );

  // ── Artifact-based DONE gate ──
  const needsRegen = await getNeedsRegenCount(sb, packageId);

  if (needsRegen === 0) {
    const pkgInFlight = await countPackageInFlight(sb, packageId);

    if (pkgInFlight > 0) {
      // Jobs still running — keep lease, just update meta
      await updateLearningContentStepMeta(sb, packageId, {
        needs_regen: 0,
        active_lesson_jobs: pkgInFlight,
        dispatch_blocked_reason: "waiting_active_jobs",
        last_probe_at: new Date().toISOString(),
      });

      return json({
        ok: true,
        batch_complete: false,
        message: `⏳ ${pkgInFlight} lesson jobs still active — waiting.`,
        active_lesson_jobs: pkgInFlight,
        needs_regen: 0,
      });
    }

    // Truly done — release lease
    await releasePackageLease(sb, packageId, "content_done", {
      needs_regen: 0,
      active_lesson_jobs: 0,
      dispatch_blocked_reason: null,
      completion_gate: { needs_regen: 0, active_jobs: 0 },
    });

    return json({
      ok: true,
      batch_complete: true,
      message: `✅ All lessons have valid content (needs_regen=0).`,
      needs_regen: 0,
      completion_gate: { needs_regen: 0, active_jobs: 0 },
    });
  }

  // ── Capacity check — release lease if no global slots ──
  if (freeSlots <= 0) {
    await releasePackageLease(sb, packageId, "no_free_slots", {
      needs_regen: needsRegen,
      dispatched: 0,
      effective_wip: effectiveWip,
      global_in_flight: globalInFlight,
      dispatch_blocked_reason: "no_free_slots",
      last_probe_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      batch_complete: false,
      message: `🔒 No free WIP slots (effective=${effectiveWip}, inFlight=${globalInFlight}).`,
      needs_regen: needsRegen,
      dispatched: 0,
      reason: "no_free_slots",
    });
  }

  // ── Per-package cap — now uses QUEUE DEPTH (pending+processing) not just in-flight ──
  // Phase B: pre-fill queue with 2x perPackageMax to eliminate cron-gap starvation
  const pkgInFlight = await countPackageInFlight(sb, packageId);

  // Count pending jobs too (queued but not yet processing)
  const { count: pkgPendingCount } = await sb
    .from("job_queue")
    .select("id", { head: true, count: "exact" })
    .eq("job_type", "lesson_generate_competency_bundle")
    .eq("package_id", packageId)
    .in("status", ["pending", "queued"]);
  const pkgPending = pkgPendingCount ?? 0;

  const queueDepth = pkgInFlight + pkgPending;
  const queueTarget = caps.perPackageMax * 2; // Phase B: pre-fill 2x to avoid cron-gap starvation
  const pkgFree = Math.max(0, queueTarget - queueDepth);

  if (pkgFree <= 0) {
    // Queue is sufficiently filled — don't release lease, just wait
    await updateLearningContentStepMeta(sb, packageId, {
      needs_regen: needsRegen,
      dispatched: 0,
      pkg_in_flight: pkgInFlight,
      pkg_pending: pkgPending,
      queue_depth: queueDepth,
      queue_target: queueTarget,
      per_package_max: caps.perPackageMax,
      dispatch_blocked_reason: "queue_prefilled",
      last_probe_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      batch_complete: false,
      message: `✅ Queue pre-filled (depth=${queueDepth}, target=${queueTarget}, inFlight=${pkgInFlight}, pending=${pkgPending}).`,
      needs_regen: needsRegen,
      dispatched: 0,
      reason: "queue_prefilled",
    });
  }

  // ── Adaptive batch: fair-share across leased packages ──
  const fairBatch = computeFairShareBatch({
    needsRegen,
    freeGlobalSlots: freeSlots,
    leasedPackageCount,
    perPackageMax: queueTarget, // Phase B: use queueTarget instead of perPackageMax for fair-share
  });
  const take = Math.min(fairBatch, pkgFree, caps.dispatchBatchMax);

  // ════════════════════════════════════════════════════════════════
  // PHASE A: Competency-Bundle Fan-Out
  // Instead of dispatching individual lesson jobs, group by competency
  // and dispatch bundle orchestrators for better observability & recovery.
  // Falls back to individual lessons for competency_id=NULL lessons.
  // ════════════════════════════════════════════════════════════════

  const competencyTargets = await selectCompetencyTargets(sb, packageId, take);
  const legacyTargets = competencyTargets.length === 0
    ? await selectTargets(sb, packageId, take)
    : [];

  if (competencyTargets.length === 0 && legacyTargets.length === 0) {
    // ── Liveness Guard: needsRegen > 0 but no dispatchable targets ──
    const neutralized = await neutralizeStaleTransientFailed(sb, packageId, 120);
    if (neutralized > 0) {
      console.warn(
        `[dispatcher] LIVENESS_GUARD: neutralized ${neutralized} stale transient-failed jobs for ${packageId.slice(0, 8)}`,
      );

      await updateLearningContentStepMeta(sb, packageId, {
        needs_regen: needsRegen,
        neutralized_stale_failed: neutralized,
        liveness_guard: true,
        dispatch_blocked_reason: "revived_after_stale_failed",
        last_probe_at: new Date().toISOString(),
      });

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

    // No targets and no stale jobs to neutralize — release lease
    await releasePackageLease(sb, packageId, "no_targets", {
      needs_regen: needsRegen,
      dispatched: 0,
      dispatch_blocked_reason: "no_targets",
      last_probe_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      batch_complete: false,
      message: `⚠️ needs_regen=${needsRegen} but no targets returned — possible race.`,
      needs_regen: needsRegen,
      dispatched: 0,
    });
  }

  // ── Enqueue competency bundle jobs ──
  let enqueued = 0;
  let deduped = 0;
  const errors: string[] = [];
  const now = Date.now();
  let bundlesEnqueued = 0;
  let legacyEnqueued = 0;

  // Primary path: competency bundles
  for (let i = 0; i < competencyTargets.length; i++) {
    const ct = competencyTargets[i];
    try {
      const result = await enqueueJob(sb, {
        job_type: "lesson_generate_competency_bundle",
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          certification_id: certificationId,
          competency_id: ct.competency_id,
          learning_field_id: ct.learning_field_id,
          needs_regen: ct.needs_regen,
        },
        batch_cursor: { competency_id: ct.competency_id },
        priority: 12,
        run_after: new Date(now + i * STAGGER_MS).toISOString(),
        max_attempts: 5,
      });
      if (result.revived) {
        console.log(`[dispatcher] Revived bundle for competency ${ct.competency_id.slice(0, 8)}`);
      }
      enqueued++;
      bundlesEnqueued++;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (msg.includes("DEDUP") || msg.includes("duplicate") || msg.includes("23505")) {
        deduped++;
      } else if (msg.includes("PACKAGE_NOT_EXECUTABLE")) {
        return json({ ok: false, error: "Package not executable", enqueued, deduped }, 409);
      } else {
        errors.push(`bundle:${ct.competency_id.slice(0, 8)}: ${msg.slice(0, 100)}`);
      }
    }
  }

  // Fallback path: individual lessons (for lessons without competency_id)
  for (let i = 0; i < legacyTargets.length; i++) {
    const t = legacyTargets[i];
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
        run_after: new Date(now + (bundlesEnqueued + i) * STAGGER_MS).toISOString(),
        max_attempts: 5,
      });
      if (result.revived) {
        console.log(`[dispatcher] Revived job for ${t.id.slice(0, 8)}:${canonicalStepKey(t.step)}`);
      }
      enqueued++;
      legacyEnqueued++;
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

  // ── Update meta with dispatch results ──
  await updateLearningContentStepMeta(sb, packageId, {
    dispatcher_mode: "competency_bundle",
    needs_regen: needsRegen,
    competency_bundles: bundlesEnqueued,
    legacy_lessons: legacyEnqueued,
    enqueue_batch: competencyTargets.length + legacyTargets.length,
    last_enqueue_count: enqueued,
    deduped_count: deduped,
    fair_share_batch: fairBatch,
    effective_wip: effectiveWip,
    fail_rate: failRate,
    leased_packages: leasedPackageCount,
    global_in_flight: globalInFlight,
    pkg_in_flight: pkgInFlight,
    dispatch_blocked_reason: null,
    lease_release_reason: null,
    last_dispatch_at: new Date().toISOString(),
  });

  console.log(
    `[dispatcher] ${packageId.slice(0, 8)}: bundles=${bundlesEnqueued} legacy=${legacyEnqueued} deduped=${deduped} needsRegen=${needsRegen} fairBatch=${fairBatch} errors=${errors.length}`
  );

  return json({
    ok: true,
    batch_complete: false,
    fan_out_skipped: false,
    message: `📤 ${bundlesEnqueued} competency bundles + ${legacyEnqueued} legacy jobs enqueued (${deduped} deduped), ${needsRegen} needs_regen.`,
    needs_regen: needsRegen,
    enqueued,
    competency_bundles: bundlesEnqueued,
    legacy_lessons: legacyEnqueued,
    deduped,
    effective_wip: effectiveWip,
    fair_share_batch: fairBatch,
    leased_packages: leasedPackageCount,
    fail_rate: failRate,
    errors: errors.length > 0 ? errors : undefined,
  });
});
