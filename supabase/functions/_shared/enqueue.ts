/**
 * SSOT Enqueue Helper
 *
 * All job insertions SHOULD use this helper to guarantee:
 * 1. worker_pool is set deterministically via poolForJobType()
 * 2. Consistent defaults for max_attempts, status, timestamps
 * 3. Revive-on-conflict: cancelled/failed jobs are reactivated instead of blocked
 *
 * Usage:
 *   import { enqueueJob } from "../_shared/enqueue.ts";
 *   await enqueueJob(sb, { job_type: "package_generate_glossary", payload: { package_id: "..." } });
 */

import { poolForJobType, type WorkerPool, assertKnownJobType } from "./job-map.ts";
import { checkFanoutLoopGuard } from "./fanout-loop-guard.ts";
import { checkValidationRequeueGuard } from "./validation-requeue-guard.ts";
import { checkPoisonLoopGuard } from "./poison-loop-guard.ts";

export interface EnqueueOpts {
  job_type: string;
  payload: Record<string, unknown>;
  package_id?: string;
  max_attempts?: number;
  priority?: number;
  run_after?: string | null;
  batch_cursor?: Record<string, unknown> | null;
  worker_pool?: WorkerPool; // override only if explicitly needed
}

export interface EnqueueResult {
  id: string;
  job_type: string;
  worker_pool: string;
  status: string;
  revived?: boolean;
}

const COUNCIL_JOB_TYPES = new Set(["package_quality_council"]);
const REPAIR_JOB_TYPES = new Set([
  "package_exam_rebalance",
  "pool_fill_bloom_gaps",
  "pool_fill_lf_gaps",
  "package_repair_exam_pool_quality",
  "repair_learning_content",
  "regenerate_learning_content_cluster",
  "package_generate_lesson_minichecks",
  "package_validate_lesson_minichecks",
  "package_validate_exam_pool",
  "package_generate_oral_exam",
  "package_generate_handbook",
  "package_run_integrity_check",
]);

export function allowedPackageStatusesForJobType(jobType: string): Set<string> {
  if (COUNCIL_JOB_TYPES.has(jobType)) {
    return new Set(["building", "council_review", "quality_gate_failed"]);
  }

  if (REPAIR_JOB_TYPES.has(jobType)) {
    return new Set(["building", "blocked", "quality_gate_failed"]);
  }

  return new Set(["building"]);
}

export function canEnqueueForPackageState(
  jobType: string,
  pkg: { status: string | null; published_at?: string | null },
): { ok: boolean; reason: string } {
  if (pkg.published_at) {
    return { ok: false, reason: "already_published" };
  }

  const status = pkg.status ?? "unknown";
  if (!allowedPackageStatusesForJobType(jobType).has(status)) {
    return { ok: false, reason: `status_${status}` };
  }

  return { ok: true, reason: "ok" };
}

export async function enqueueJob(
  // deno-lint-ignore no-explicit-any
  sb: any,
  opts: EnqueueOpts,
): Promise<EnqueueResult> {
  // ── SSOT Guard: reject unknown job types at enqueue time (permanent, never retry) ──
  try {
    assertKnownJobType(opts.job_type);
  } catch (e) {
    // Enrich error with context so callers can classify as permanent
    const err = e instanceof Error ? e : new Error(String(e));
    (err as any).permanent = true;
    (err as any).error_class = "unknown_job_type";
    throw err;
  }

  const worker_pool = opts.worker_pool ?? poolForJobType(opts.job_type);

  // ── SSOT Pool Guard: fail fast on pool drift ──
  const ssotPool = poolForJobType(opts.job_type);
  if (opts.worker_pool && opts.worker_pool !== ssotPool) {
    console.warn(`[enqueue] SSOT_POOL_OVERRIDE: ${opts.job_type} forced to "${opts.worker_pool}" but SSOT says "${ssotPool}"`);
  }
  if (worker_pool !== ssotPool && !opts.worker_pool) {
    throw new Error(`SSOT_POOL_GUARD: ${opts.job_type} resolved to "${worker_pool}" but SSOT requires "${ssotPool}"`);
  }

  const now = new Date().toISOString();

  const packageId = opts.package_id ?? (opts.payload?.package_id as string) ?? null;

  // Hard guard: never enqueue package-bound jobs for immutable/non-building packages.
  // This prevents infinite requeue loops on already published packages.
  // Covers ALL job types with a package_id (including pool_fill_lf_gaps).
  if (packageId) {
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id,status,published_at,course_id,curriculum_id")
      .eq("id", packageId)
      .maybeSingle();

    if (pkgErr) throw pkgErr;
    if (!pkg) throw new Error(`PACKAGE_NOT_FOUND:${packageId}`);

    // ── Payload-Decoupling: auto-resolve secondary IDs from course_packages ──
    // Ensures jobs never fail due to missing context that is deterministically derivable.
    if (pkg.course_id && !opts.payload?.course_id) {
      opts.payload = { ...opts.payload, course_id: pkg.course_id };
    }
    if (pkg.curriculum_id && !opts.payload?.curriculum_id) {
      opts.payload = { ...opts.payload, curriculum_id: pkg.curriculum_id };
    }

    const executionGate = canEnqueueForPackageState(opts.job_type, {
      status: pkg.status,
      published_at: pkg.published_at,
    });

    if (!executionGate.ok) {
      // Fire-and-forget alert for observability
      const reason = executionGate.reason;
      try {
        await sb.from("admin_notifications").insert({
          title: "Immutability Guard: enqueue blocked",
          body: `Job ${opts.job_type} for package ${packageId} blocked (${reason}).`,
          category: "ops",
          severity: "warn",
          entity_type: "package",
          entity_id: packageId as unknown as string,
          metadata: { job_type: opts.job_type, reason, package_status: pkg.status },
        });
      } catch (_e) { /* fire-and-forget */ }

      throw new Error(`PACKAGE_NOT_EXECUTABLE:${reason}:${packageId}`);
    }
  }

  // ── F-3: Fanout Loop Guard — prevents re-enqueue storms across ALL paths ──
  const fanoutCheck = await checkFanoutLoopGuard(sb, opts.job_type, packageId);
  if (fanoutCheck.blocked) {
    console.log(`[enqueue] FANOUT_BLOCKED: ${opts.job_type} for ${packageId?.slice(0, 8)} — ${fanoutCheck.reason}`);
    return {
      id: "00000000-0000-0000-0000-000000000000",
      job_type: opts.job_type,
      worker_pool: worker_pool,
      status: "blocked_by_guard",
      revived: false,
    } as EnqueueResult;
  }

  // ── F-4: Validation Requeue Guard — prevents no-progress validation loops ──
  const valCheck = await checkValidationRequeueGuard(sb, opts.job_type, packageId);
  if (valCheck.blocked) {
    console.log(`[enqueue] VALIDATION_BLOCKED: ${opts.job_type} for ${packageId?.slice(0, 8)} — ${valCheck.reason}`);
    return {
      id: "00000000-0000-0000-0000-000000000000",
      job_type: opts.job_type,
      worker_pool: worker_pool,
      status: "blocked_by_guard",
      revived: false,
    } as EnqueueResult;
  }

  const idempotencyKey = opts.batch_cursor
    ? `${opts.job_type}:${packageId ?? "global"}:${JSON.stringify(opts.batch_cursor)}`
    : `${opts.job_type}:${packageId ?? "global"}`;

  const row = {
    id: crypto.randomUUID(),
    job_type: opts.job_type,
    status: "pending",
    payload: opts.payload ?? {},
    package_id: packageId,
    max_attempts: opts.max_attempts ?? 8,
    priority: opts.priority ?? 10,
    worker_pool,
    run_after: opts.run_after ?? null,
    batch_cursor: opts.batch_cursor ?? null,
    idempotency_key: idempotencyKey,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await sb
    .from("job_queue")
    .insert(row)
    .select("id, job_type, worker_pool, status")
    .single();

  if (!error) return data as EnqueueResult;

  // ── Revive-on-conflict ──
  // If unique constraint violation (23505), check for a cancelled/failed row
  // with the same idempotency_key and revive it instead of failing.
  const isUniqueViolation =
    error.code === "23505" ||
    error.message?.includes("duplicate key") ||
    error.message?.includes("unique constraint");

  if (!isUniqueViolation) throw error;

  // Find the existing inactive row
  const { data: existing } = await sb
    .from("job_queue")
    .select("id, job_type, worker_pool, status")
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["cancelled", "failed"])
    .limit(1)
    .maybeSingle();

  if (!existing) {
    // Active (pending/processing) row already exists — idempotency working correctly
    // Return a synthetic result so callers don't crash
    const { data: active } = await sb
      .from("job_queue")
      .select("id, job_type, worker_pool, status")
      .eq("idempotency_key", idempotencyKey)
      .in("status", ["pending", "queued", "processing"])
      .limit(1)
      .maybeSingle();

    if (active) {
      console.log(`[enqueue] DEDUP: ${opts.job_type} already active (${active.status}) — returning existing job ${String(active.id).slice(0,8)}`);
      return { ...active, revived: false } as EnqueueResult;
    }

    // Also try matching by package_id + job_type (for partial unique index hits)
    if (packageId) {
      const { data: activeByPkg } = await sb
        .from("job_queue")
        .select("id, job_type, worker_pool, status")
        .eq("package_id", packageId)
        .eq("job_type", opts.job_type)
        .in("status", ["pending", "queued", "processing"])
        .limit(1)
        .maybeSingle();

      if (activeByPkg) {
        console.log(`[enqueue] DEDUP_PKG: ${opts.job_type} for ${packageId.slice(0,8)} already active — returning existing job ${String(activeByPkg.id).slice(0,8)}`);
        return { ...activeByPkg, revived: false } as EnqueueResult;
      }
    }

    // No row found at all — unexpected, rethrow original error
    throw error;
  }

  // Revive: reset the cancelled/failed row to pending
  const { data: revived, error: reviveErr } = await sb
    .from("job_queue")
    .update({
      status: "pending",
      payload: opts.payload ?? existing.payload,
      priority: opts.priority ?? 10,
      worker_pool,
      run_after: opts.run_after ?? null,
      attempts: 0,
      last_error: null,
      error: null,
      started_at: null,
      completed_at: null,
      locked_by: null,
      locked_at: null,
      updated_at: now,
      meta: {},  // clear old blocked-mode metadata
    })
    .eq("id", existing.id)
    .select("id, job_type, worker_pool, status")
    .single();

  if (reviveErr) throw reviveErr;

  return { ...revived, revived: true } as EnqueueResult;
}
