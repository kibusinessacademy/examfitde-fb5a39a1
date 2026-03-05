/**
 * SSOT Learning-Content Scheduler
 *
 * Provides artifact-based scheduling primitives:
 *   - needs_regen count per package (content NULL / placeholder / tier1_failed)
 *   - target selection with oldest-first ordering
 *   - adaptive global WIP throttle based on recent fail rate
 *
 * Used by the dispatcher (package-generate-learning-content) for
 * fair round-robin scheduling across building packages.
 */

// deno-lint-ignore-file no-explicit-any

export type SchedulerCaps = {
  globalWipMax: number;       // max global in-flight lesson jobs
  perPackageMax: number;      // max in-flight per package
  dispatchBatchMax: number;   // max jobs dispatched per tick
};

function envInt(name: string, def: number): number {
  const v = Number(Deno.env.get(name) ?? "");
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

export function getSchedulerCaps(): SchedulerCaps {
  return {
    globalWipMax: envInt("LC_GLOBAL_WIP_MAX", 40),
    perPackageMax: envInt("LC_PER_PACKAGE_MAX", 3),
    dispatchBatchMax: envInt("LC_DISPATCH_BATCH_MAX", 120),
  };
}

// ── SSOT needs_regen filter ──
const NEEDS_REGEN_OR_FILTER = [
  "content.is.null",
  "qc_status.eq.tier1_failed",
  "content->>_placeholder.eq.true",
  "content->>_regenerating.eq.true",
].join(",");

/**
 * Count lessons needing regeneration for a package.
 * Robust 2-step join: package → course → modules → lessons.
 */
export async function getNeedsRegenCount(
  sb: any,
  packageId: string,
): Promise<number> {
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg?.course_id) return 0;

  const { data: mods } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: any) => m.id);
  if (moduleIds.length === 0) return 0;

  const { count, error } = await sb
    .from("lessons")
    .select("id", { head: true, count: "exact" })
    .in("module_id", moduleIds)
    .or(NEEDS_REGEN_OR_FILTER);

  if (error) {
    console.warn(`[scheduler] getNeedsRegenCount error: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

/**
 * Select lesson targets needing regeneration, oldest-first.
 */
export async function selectTargets(
  sb: any,
  packageId: string,
  limit: number,
): Promise<any[]> {
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg?.course_id) return [];

  const { data: mods } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: any) => m.id);
  if (moduleIds.length === 0) return [];

  const { data: lessons } = await sb
    .from("lessons")
    .select("id, title, step, qc_status")
    .in("module_id", moduleIds)
    .or(NEEDS_REGEN_OR_FILTER)
    .order("updated_at", { ascending: true })
    .limit(limit);

  return lessons ?? [];
}

/**
 * Adaptive throttle: reduce global WIP when recent fail rate is high.
 * Uses job_queue status in a 15-min window as proxy.
 */
export async function computeAdaptiveWip(
  sb: any,
  baseWip: number,
): Promise<{ effectiveWip: number; failRate: number }> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();

  const { data: rows, error } = await sb
    .from("job_queue")
    .select("status")
    .eq("job_type", "lesson_generate_content")
    .gte("created_at", since);

  if (error || !rows) return { effectiveWip: baseWip, failRate: 0 };

  const total = rows.length;
  if (total < 20) return { effectiveWip: baseWip, failRate: 0 };

  const failed = rows.filter((r: any) => r.status === "failed").length;
  const failRate = failed / total;

  if (failRate >= 0.5) return { effectiveWip: Math.max(8, Math.floor(baseWip * 0.4)), failRate };
  if (failRate >= 0.3) return { effectiveWip: Math.max(12, Math.floor(baseWip * 0.6)), failRate };
  if (failRate >= 0.2) return { effectiveWip: Math.max(16, Math.floor(baseWip * 0.75)), failRate };
  return { effectiveWip: baseWip, failRate };
}

/**
 * Count global in-flight lesson_generate_content jobs.
 */
export async function countGlobalInFlight(sb: any): Promise<number> {
  const { count, error } = await sb
    .from("job_queue")
    .select("id", { head: true, count: "exact" })
    .eq("job_type", "lesson_generate_content")
    .in("status", ["pending", "queued", "processing"]);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Count per-package in-flight lesson jobs.
 */
export async function countPackageInFlight(sb: any, packageId: string): Promise<number> {
  const { count, error } = await sb
    .from("job_queue")
    .select("id", { head: true, count: "exact" })
    .eq("job_type", "lesson_generate_content")
    .eq("package_id", packageId)
    .in("status", ["pending", "queued", "processing"]);
  if (error) return 0;
  return count ?? 0;
}
