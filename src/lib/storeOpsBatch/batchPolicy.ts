/**
 * STORE.OPS.BATCH.OS.1 — Policy (pure).
 *
 * Encodes hard rules: which action types are allowed and per-manifest
 * applicability checks that prevent unsafe enqueues.
 */
import {
  ALLOWED_BATCH_ACTIONS,
  FORBIDDEN_BATCH_ACTIONS,
  type BatchActionType,
  type BatchBlocker,
  type BatchPlanInput,
} from "./contracts.ts";

export function isAllowedAction(action: string): action is BatchActionType {
  return (ALLOWED_BATCH_ACTIONS as readonly string[]).includes(action);
}

export function isForbiddenAction(action: string): boolean {
  return (FORBIDDEN_BATCH_ACTIONS as readonly string[]).includes(action);
}

export function filterAllowedActions(
  actions: string[],
): { allowed: BatchActionType[]; rejected: string[] } {
  const allowed: BatchActionType[] = [];
  const rejected: string[] = [];
  for (const a of actions) {
    if (isAllowedAction(a)) allowed.push(a);
    else rejected.push(a);
  }
  return { allowed, rejected };
}

/**
 * Per-manifest applicability check. Returns blockers if the action cannot be
 * safely planned for the given manifest snapshot. No blockers = ready to run.
 */
export function checkApplicability(
  manifestId: string,
  action: BatchActionType,
  input: BatchPlanInput,
): BatchBlocker[] {
  const manifest = input.manifests.find((m) => m.manifest_id === manifestId);
  const blockers: BatchBlocker[] = [];

  if (!manifest) {
    blockers.push({ code: "MANIFEST_INCOMPLETE", message: "Manifest snapshot fehlt." });
    return blockers;
  }
  if (!manifest.complete) {
    blockers.push({ code: "MANIFEST_INCOMPLETE", message: "Manifest unvollständig." });
  }

  const lifecycle = input.lifecycle.find((l) => l.manifest_id === manifestId);
  if (lifecycle?.blocked) {
    blockers.push({ code: "LIFECYCLE_BLOCKED", message: `Lifecycle blockiert (${lifecycle.current_state}).` });
  }

  const gate = input.review_gates.find((g) => g.manifest_id === manifestId);
  const builds = input.builds.filter((b) => b.manifest_id === manifestId);

  switch (action) {
    case "create_release_candidate":
    case "export_submission_package": {
      if (!gate || gate.blocked || gate.review_state !== "review_ready") {
        blockers.push({ code: "REVIEW_GATE_BLOCKED", message: "Review-Gate nicht review_ready." });
      }
      if (builds.some((b) => b.status === "failed")) {
        blockers.push({ code: "BUILD_FAILED", message: "Mindestens ein Build fehlgeschlagen." });
      }
      break;
    }
    case "run_android_dry_build": {
      // No-op pre-check; dry builds are always allowed when manifest complete.
      break;
    }
    case "run_ios_dry_build": {
      break;
    }
    case "generate_listing":
    case "enqueue_screenshots":
    case "run_review_gate":
    case "run_kpi_snapshot":
    case "evaluate_lifecycle":
      break;
  }

  return blockers;
}
