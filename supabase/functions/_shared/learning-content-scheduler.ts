/**
 * SSOT Learning-Content Scheduler
 *
 * Provides artifact-based scheduling primitives via DB RPCs:
 *   - needs_regen count per package (content NULL / placeholder / tier1_failed)
 *   - target selection with oldest-first ordering
 *   - adaptive global WIP throttle based on recent fail rate
 *   - SSOT inflight counts via RPCs (no fragile JSON-path filters)
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
    globalWipMax: envInt("LC_GLOBAL_WIP_MAX", 80),         // Phase C: 60 → 80 aggressive growth
    perPackageMax: envInt("LC_PER_PACKAGE_MAX", 30),        // Phase C: 25 → 30 more parallel per package
    dispatchBatchMax: envInt("LC_DISPATCH_BATCH_MAX", 250), // Phase C: 200 → 250 headroom for throughput
  };
}

/**
 * Compute fair-share quota for a single package.
 * Distributes free global slots evenly across all leased packages,
 * capped by per-package max and needs_regen.
 */
export function computeFairShareBatch(opts: {
  needsRegen: number;
  freeGlobalSlots: number;
  leasedPackageCount: number;
  perPackageMax: number;
}): number {
  const { needsRegen, freeGlobalSlots, leasedPackageCount, perPackageMax } = opts;
  if (needsRegen <= 0 || freeGlobalSlots <= 0) return 0;
  const divisor = Math.max(1, leasedPackageCount);
  const fairShare = Math.ceil(freeGlobalSlots / divisor);
  return Math.max(1, Math.min(needsRegen, perPackageMax, fairShare));
}

/**
 * Count currently leased (building) packages for fair-share distribution.
 * Uses SSOT RPC — falls back to direct query if RPC not yet deployed.
 */
export async function countLeasedPackages(sb: any): Promise<number> {
  // Try RPC first (SSOT)
  const { data: rpcData, error: rpcErr } = await sb.rpc("count_leased_building_packages");
  if (!rpcErr && rpcData != null) {
    return Math.max(1, Number(rpcData));
  }

  // Fallback: direct query
  if (rpcErr) {
    console.warn(`[scheduler] count_leased_building_packages RPC failed, using fallback: ${rpcErr.message}`);
  }
  const { count, error } = await sb
    .from("package_leases")
    .select("package_id", { head: true, count: "exact" })
    .gt("lease_until", new Date().toISOString());
  if (error) return 1;
  return Math.max(1, count ?? 1);
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
    .neq("step", "mini_check")
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
    .neq("step", "mini_check")
    .or(NEEDS_REGEN_OR_FILTER)
    .order("created_at", { ascending: true })
    .limit(limit);

  return lessons ?? [];
}

/**
 * Select competencies that have lessons needing regeneration.
 * Returns distinct competency_ids with their lesson counts, ordered by
 * fewest remaining (almost-done-first for throughput optimization).
 */
export async function selectCompetencyTargets(
  sb: any,
  packageId: string,
  limit: number,
): Promise<Array<{ competency_id: string; learning_field_id: string | null; needs_regen: number }>> {
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg?.course_id) return [];

  const { data: mods } = await sb
    .from("modules")
    .select("id, learning_field_id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: any) => m.id);
  if (moduleIds.length === 0) return [];

  // Build a module→learning_field lookup
  const modToLf = new Map<string, string>();
  for (const m of mods ?? []) {
    if (m.learning_field_id) modToLf.set(m.id, m.learning_field_id);
  }

  // Get all lessons needing regen with their competency_id
  const { data: lessons } = await sb
    .from("lessons")
    .select("id, competency_id, module_id")
    .in("module_id", moduleIds)
    .not("competency_id", "is", null)
    .or(NEEDS_REGEN_OR_FILTER)
    .order("created_at", { ascending: true });

  if (!lessons || lessons.length === 0) return [];

  // Group by competency_id, count needs_regen per competency
  const byCompetency = new Map<string, { competency_id: string; learning_field_id: string | null; needs_regen: number }>();
  for (const l of lessons) {
    const cid = l.competency_id;
    if (!cid) continue;
    const existing = byCompetency.get(cid);
    if (existing) {
      existing.needs_regen++;
    } else {
      byCompetency.set(cid, {
        competency_id: cid,
        learning_field_id: modToLf.get(l.module_id) ?? null,
        needs_regen: 1,
      });
    }
  }

  // Sort by fewest remaining (almost-done-first for throughput)
  const sorted = [...byCompetency.values()].sort((a, b) => a.needs_regen - b.needs_regen);
  return sorted.slice(0, limit);
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
 * Uses SSOT RPC — falls back to direct query if RPC not yet deployed.
 */
export async function countGlobalInFlight(sb: any): Promise<number> {
  // Try RPC first (SSOT)
  const { data: rpcData, error: rpcErr } = await sb.rpc("count_global_inflight_lesson_jobs");
  if (!rpcErr && rpcData != null) {
    return Number(rpcData);
  }

  // Fallback: direct query
  if (rpcErr) {
    console.warn(`[scheduler] count_global_inflight_lesson_jobs RPC failed, using fallback: ${rpcErr.message}`);
  }
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
 * Uses SSOT RPC — falls back to direct query if RPC not yet deployed.
 */
export async function countPackageInFlight(sb: any, packageId: string): Promise<number> {
  // Try RPC first (SSOT)
  const { data: rpcData, error: rpcErr } = await sb.rpc("count_package_inflight_jobs", {
    p_package_id: packageId,
  });
  if (!rpcErr && rpcData != null) {
    return Number(rpcData);
  }

  // Fallback: direct query on top-level package_id column
  if (rpcErr) {
    console.warn(`[scheduler] count_package_inflight_jobs RPC failed for ${packageId.slice(0, 8)}, using fallback: ${rpcErr.message}`);
  }
  const { count, error } = await sb
    .from("job_queue")
    .select("id", { head: true, count: "exact" })
    .eq("job_type", "lesson_generate_content")
    .eq("package_id", packageId)
    .in("status", ["pending", "queued", "processing"]);
  if (error) return 0;
  return count ?? 0;
}
