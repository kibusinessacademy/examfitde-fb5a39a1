/**
 * STORE.OPS.AUTOPILOT.OS.1 — Policy (pure).
 *
 * Encodes the allow-list and per-action applicability gates.
 */
import {
  ALLOWED_AUTOPILOT_ACTIONS,
  ALWAYS_SAFE_ACTIONS,
  FORBIDDEN_AUTOPILOT_ACTIONS,
  type AutopilotActionType,
  type AutopilotBlocker,
  type AutopilotInput,
} from "./contracts.ts";

export function isAllowedAction(a: string): a is AutopilotActionType {
  return (ALLOWED_AUTOPILOT_ACTIONS as readonly string[]).includes(a);
}

export function isForbiddenAction(a: string): boolean {
  return (FORBIDDEN_AUTOPILOT_ACTIONS as readonly string[]).includes(a);
}

export function isAlwaysSafeAction(a: AutopilotActionType): boolean {
  return (ALWAYS_SAFE_ACTIONS as readonly string[]).includes(a);
}

export function filterAllowedActions(actions: string[]): {
  allowed: AutopilotActionType[];
  rejected: string[];
} {
  const allowed: AutopilotActionType[] = [];
  const rejected: string[] = [];
  for (const a of actions) {
    if (isAllowedAction(a)) allowed.push(a);
    else rejected.push(a);
  }
  return { allowed, rejected };
}

/** Returns blockers if action cannot run safely against the given manifest snapshot. */
export function checkApplicability(
  manifestId: string,
  action: AutopilotActionType,
  input: AutopilotInput,
): AutopilotBlocker[] {
  const blockers: AutopilotBlocker[] = [];
  if (isForbiddenAction(action)) {
    blockers.push({ code: "FORBIDDEN_ACTION", message: `${action} ist verboten.` });
    return blockers;
  }
  const manifest = input.manifests.find((m) => m.manifest_id === manifestId);
  if (!manifest) {
    blockers.push({ code: "ACTION_NOT_APPLICABLE", message: "Manifest fehlt." });
    return blockers;
  }

  const gate = input.review_gates.find((g) => g.manifest_id === manifestId);
  const lifecycle = input.lifecycle.find((l) => l.manifest_id === manifestId);
  const builds = input.builds.filter((b) => b.manifest_id === manifestId);
  const listings = input.listings.filter((l) => l.manifest_id === manifestId);
  const screenshots = input.screenshots.filter((s) => s.manifest_id === manifestId);
  const batch = input.batch_status.find((b) => b.manifest_id === manifestId);
  const drift = input.hash_drift.find((h) => h.manifest_id === manifestId);

  if (lifecycle?.has_error) {
    blockers.push({ code: "LIFECYCLE_ERROR", message: "Lifecycle hat offene Fehler." });
  }
  if (batch?.has_open_failures) {
    blockers.push({ code: "BATCH_ERROR", message: "Offene Batch-Fehler." });
  }

  switch (action) {
    case "create_release_candidate":
    case "export_submission_package": {
      if (!gate || !gate.review_ready) {
        blockers.push({ code: "REVIEW_NOT_READY", message: "Review-Gate nicht ready." });
      }
      if (drift?.drifted) {
        blockers.push({ code: "HASH_MISMATCH", message: "Hash-Drift erkannt." });
      }
      const needAndroid = builds.find((b) => b.platform === "android");
      const needIos = builds.find((b) => b.platform === "ios");
      if (!needAndroid || needAndroid.status !== "success") {
        blockers.push({ code: "MISSING_BUILD", message: "Android-Build fehlt." });
      }
      if (!needIos || needIos.status !== "success") {
        blockers.push({ code: "MISSING_BUILD", message: "iOS-Build fehlt." });
      }
      const androidListing = listings.find((l) => l.platform === "android");
      const iosListing = listings.find((l) => l.platform === "ios");
      if (!androidListing || androidListing.status !== "approved") {
        blockers.push({ code: "MISSING_LISTING", message: "Android-Listing fehlt." });
      }
      if (!iosListing || iosListing.status !== "approved") {
        blockers.push({ code: "MISSING_LISTING", message: "iOS-Listing fehlt." });
      }
      const androidShots = screenshots.find((s) => s.platform === "android");
      const iosShots = screenshots.find((s) => s.platform === "ios");
      if (!androidShots || androidShots.ready_count < androidShots.required_count) {
        blockers.push({ code: "MISSING_SCREENSHOTS", message: "Android-Screenshots unvollständig." });
      }
      if (!iosShots || iosShots.ready_count < iosShots.required_count) {
        blockers.push({ code: "MISSING_SCREENSHOTS", message: "iOS-Screenshots unvollständig." });
      }
      break;
    }
    case "enqueue_screenshots":
    case "generate_listing":
    case "run_android_dry_build":
    case "run_ios_dry_build":
    case "cleanup_stale_candidates":
    case "refresh_hashes":
    case "run_review_gate":
    case "run_store_ops_kpi":
    case "run_lifecycle_projection":
    case "refresh_projection":
      break;
  }

  return blockers;
}

/** Estimated runtime in seconds per action (deterministic constants). */
export const ESTIMATED_RUNTIME: Record<AutopilotActionType, number> = {
  run_review_gate: 10,
  run_store_ops_kpi: 15,
  run_lifecycle_projection: 8,
  generate_listing: 30,
  enqueue_screenshots: 5,
  run_android_dry_build: 120,
  run_ios_dry_build: 180,
  create_release_candidate: 5,
  export_submission_package: 12,
  cleanup_stale_candidates: 4,
  refresh_hashes: 6,
  refresh_projection: 5,
};

/** Deterministic execution order for the recommended sequence. */
export const ACTION_PRIORITY: Record<AutopilotActionType, number> = {
  run_review_gate: 10,
  run_store_ops_kpi: 20,
  run_lifecycle_projection: 30,
  refresh_projection: 40,
  refresh_hashes: 50,
  cleanup_stale_candidates: 60,
  generate_listing: 70,
  enqueue_screenshots: 80,
  run_android_dry_build: 90,
  run_ios_dry_build: 100,
  create_release_candidate: 110,
  export_submission_package: 120,
};
