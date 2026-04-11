/**
 * SSOT Prebuild Layer — Deterministic queue-bypass for pipeline steps.
 *
 * Before the runner claims jobs from the queue, it checks each leased/building
 * package for steps that can be finalized deterministically via SQL RPCs.
 *
 * Rules:
 *  - idempotent, fail-closed
 *  - respects DAG predecessors
 *  - only marks done when postcondition is verified
 *  - writes audit meta
 *  - max N hops per package per pass (anti-monopolization)
 *  - shared budget with normal claiming
 */

type SB = any;

/** Step keys that have a matching fn_prebuild_* RPC */
const PREBUILD_STEP_TO_RPC: Record<string, string> = {
  finalize_learning_content: "fn_prebuild_finalize_learning_content",
  validate_blueprints: "fn_prebuild_validate_blueprints",
  promote_blueprint_variants: "fn_prebuild_promote_blueprint_variants",
  validate_handbook: "fn_prebuild_validate_handbook",
  validate_handbook_depth: "fn_prebuild_validate_handbook_depth",
};

/** Ordered list of prebuildable step keys (checked in DAG order) */
const PREBUILD_STEP_ORDER = [
  "finalize_learning_content",
  "validate_blueprints",
  "promote_blueprint_variants",
  "validate_handbook",
  "validate_handbook_depth",
];

export interface PrebuildResult {
  status: string;   // done | deferred | blocked | noop
  advanced: boolean;
  reason: string;
  meta: Record<string, unknown>;
}

export interface PrebuildPassSummary {
  packages_checked: number;
  steps_advanced: number;
  steps_deferred: number;
  steps_blocked: number;
  details: Array<{
    package_id: string;
    step_key: string;
    status: string;
    reason: string;
  }>;
}

/**
 * Try to prebuild a single step via its SQL RPC.
 * Returns a normalized PrebuildResult (never throws).
 */
async function tryPrebuildStep(
  sb: SB,
  packageId: string,
  stepKey: string,
): Promise<PrebuildResult> {
  const rpc = PREBUILD_STEP_TO_RPC[stepKey];
  if (!rpc) {
    return { status: "noop", advanced: false, reason: "NOT_PREBUILDABLE", meta: {} };
  }

  try {
    const { data, error } = await sb.rpc(rpc, { p_package_id: packageId });

    if (error) {
      console.warn(`[prebuild] RPC ${rpc} error for ${packageId.slice(0, 8)}: ${error.message}`);
      return {
        status: "deferred",
        advanced: false,
        reason: `RPC_ERROR:${error.message.slice(0, 200)}`,
        meta: {},
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { status: "noop", advanced: false, reason: "EMPTY_RESULT", meta: {} };
    }

    return {
      status: row.status ?? "noop",
      advanced: row.advanced ?? false,
      reason: row.reason ?? "UNKNOWN",
      meta: row.meta ?? {},
    };
  } catch (e) {
    console.error(`[prebuild] Unexpected error in ${rpc} for ${packageId.slice(0, 8)}: ${(e as Error).message}`);
    return {
      status: "deferred",
      advanced: false,
      reason: `EXCEPTION:${(e as Error).message.slice(0, 200)}`,
      meta: {},
    };
  }
}

/**
 * Run the prebuild pass for all building packages.
 *
 * @param sb - Supabase client (service role)
 * @param maxPackages - max packages to check (budget control)
 * @param maxHopsPerPackage - max steps to advance per package (anti-monopolization)
 */
export async function runPrebuildPass(
  sb: SB,
  maxPackages: number = 5,
  maxHopsPerPackage: number = 3,
): Promise<PrebuildPassSummary> {
  const summary: PrebuildPassSummary = {
    packages_checked: 0,
    steps_advanced: 0,
    steps_deferred: 0,
    steps_blocked: 0,
    details: [],
  };

  // Find building packages with queued/pending prebuildable steps
  const { data: candidates, error: candErr } = await sb
    .from("package_steps")
    .select("package_id, step_key, status")
    .in("step_key", PREBUILD_STEP_ORDER)
    .in("status", ["queued", "pending", "building"])
    .order("package_id")
    .limit(maxPackages * 3); // over-fetch, then deduplicate

  if (candErr || !candidates || candidates.length === 0) {
    return summary;
  }

  // Group by package_id, deduplicate
  const byPackage = new Map<string, string[]>();
  for (const row of candidates) {
    if (!byPackage.has(row.package_id)) byPackage.set(row.package_id, []);
    byPackage.get(row.package_id)!.push(row.step_key);
  }

  let packagesProcessed = 0;

  for (const [packageId, stepKeys] of byPackage) {
    if (packagesProcessed >= maxPackages) break;
    packagesProcessed++;
    summary.packages_checked++;

    // Sort by DAG order
    const ordered = PREBUILD_STEP_ORDER.filter((s) => stepKeys.includes(s));

    let hops = 0;
    for (const stepKey of ordered) {
      if (hops >= maxHopsPerPackage) break;

      const result = await tryPrebuildStep(sb, packageId, stepKey);

      summary.details.push({
        package_id: packageId.slice(0, 8),
        step_key: stepKey,
        status: result.status,
        reason: result.reason,
      });

      if (result.advanced) {
        summary.steps_advanced++;
        hops++;
        console.log(
          `[prebuild] ✅ ${stepKey} → done for ${packageId.slice(0, 8)} (reason=${result.reason})`,
        );
      } else if (result.status === "blocked") {
        summary.steps_blocked++;
        break; // Don't try later steps if one is blocked
      } else if (result.status === "deferred") {
        summary.steps_deferred++;
        // Don't break — later steps might be independently prebuildable
      }
      // noop → just continue
    }
  }

  if (summary.steps_advanced > 0) {
    console.log(
      `[prebuild] Pass complete: ${summary.packages_checked} packages, ` +
      `${summary.steps_advanced} advanced, ${summary.steps_deferred} deferred, ` +
      `${summary.steps_blocked} blocked`,
    );
  }

  return summary;
}
