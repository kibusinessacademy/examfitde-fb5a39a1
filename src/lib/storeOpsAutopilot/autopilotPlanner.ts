/**
 * STORE.OPS.AUTOPILOT.OS.1 — Planner (pure, deterministic).
 */
import type {
  AutopilotAction,
  AutopilotActionType,
  AutopilotInput,
  AutopilotPlan,
} from "./contracts.ts";
import {
  ACTION_PRIORITY,
  ALLOWED_AUTOPILOT_ACTIONS,
  ESTIMATED_RUNTIME,
  checkApplicability,
  filterAllowedActions,
  isAlwaysSafeAction,
} from "./autopilotPolicy.ts";
import { evaluateRisk } from "./riskEvaluator.ts";

function dedupe(items: AutopilotAction[]): AutopilotAction[] {
  const map = new Map<string, AutopilotAction>();
  for (const it of items) {
    const key = `${it.manifest_id}::${it.action_type}`;
    if (!map.has(key)) map.set(key, it);
  }
  return [...map.values()];
}

function sortActions(a: AutopilotAction, b: AutopilotAction): number {
  const pa = ACTION_PRIORITY[a.action_type] ?? 999;
  const pb = ACTION_PRIORITY[b.action_type] ?? 999;
  if (pa !== pb) return pa - pb;
  return a.manifest_id.localeCompare(b.manifest_id);
}

export function planAutopilot(input: AutopilotInput): AutopilotPlan {
  const warnings: string[] = [];
  const risk = evaluateRisk(input);

  if (input.mode === "disabled") {
    return {
      run_id: input.run_id,
      mode: input.mode,
      evaluated_at_reference: input.evaluated_at_reference,
      safe_actions: [],
      manual_actions: [],
      blocked_actions: [],
      risk_score: risk.score,
      risk_level: risk.level,
      estimated_runtime_seconds: 0,
      recommended_sequence: [],
      next_manual_step: "Autopilot ist deaktiviert.",
      warnings: ["Autopilot disabled — no plan generated."],
    };
  }

  let actions: AutopilotActionType[];
  if (input.requested_actions === "auto") {
    actions = [...ALLOWED_AUTOPILOT_ACTIONS];
  } else {
    const filtered = filterAllowedActions(input.requested_actions);
    actions = filtered.allowed;
    for (const r of filtered.rejected) warnings.push(`Verbotene/unbekannte Aktion verworfen: ${r}`);
  }

  const manifestIds = [...new Set(input.manifests.map((m) => m.manifest_id))].sort();
  if (input.mode === "maintenance") {
    actions = actions.filter(
      (a) =>
        a === "refresh_hashes" ||
        a === "refresh_projection" ||
        a === "cleanup_stale_candidates" ||
        a === "run_store_ops_kpi" ||
        a === "run_lifecycle_projection",
    );
  }
  actions = [...new Set(actions)];

  const safe: AutopilotAction[] = [];
  const manual: AutopilotAction[] = [];
  const blocked: AutopilotAction[] = [];

  for (const manifest_id of manifestIds) {
    for (const action_type of actions) {
      const blockers = checkApplicability(manifest_id, action_type, input);
      const runtime = ESTIMATED_RUNTIME[action_type] ?? 0;
      if (blockers.length > 0) {
        blocked.push({ manifest_id, action_type, status: "blocked", blockers, estimated_runtime_seconds: runtime });
        continue;
      }
      const isSafeNow =
        input.mode === "safe_execute" &&
        (isAlwaysSafeAction(action_type) ||
          (input.review_gates.find((g) => g.manifest_id === manifest_id)?.review_ready ?? false));
      if (isSafeNow) {
        safe.push({ manifest_id, action_type, status: "safe", blockers: [], estimated_runtime_seconds: runtime });
      } else {
        manual.push({
          manifest_id,
          action_type,
          status: "manual_required",
          blockers: [],
          estimated_runtime_seconds: runtime,
        });
      }
    }
  }

  const dedupedSafe = dedupe(safe).sort(sortActions);
  const dedupedManual = dedupe(manual).sort(sortActions);
  const dedupedBlocked = dedupe(blocked).sort(sortActions);

  const estimated_runtime_seconds = dedupedSafe.reduce((s, a) => s + a.estimated_runtime_seconds, 0);
  const recommended_sequence = [...new Set(dedupedSafe.map((a) => a.action_type))].sort(
    (a, b) => (ACTION_PRIORITY[a] ?? 999) - (ACTION_PRIORITY[b] ?? 999),
  );

  let next_manual_step: string | null = null;
  if (dedupedManual.length > 0) {
    const first = dedupedManual[0];
    next_manual_step = `${first.action_type} für ${first.manifest_id} manuell vorbereiten.`;
  } else if (dedupedBlocked.length > 0) {
    const first = dedupedBlocked[0];
    next_manual_step = `${first.action_type} für ${first.manifest_id} blockiert: ${first.blockers[0]?.code}`;
  } else if (input.mode === "recommend_only") {
    next_manual_step = "Autopilot empfiehlt nur — Safe Run separat freigeben.";
  }

  if (input.known_limitations && !input.known_limitations.lifecycle_implemented) {
    warnings.push("Lifecycle nicht vollständig implementiert.");
  }

  return {
    run_id: input.run_id,
    mode: input.mode,
    evaluated_at_reference: input.evaluated_at_reference,
    safe_actions: dedupedSafe,
    manual_actions: dedupedManual,
    blocked_actions: dedupedBlocked,
    risk_score: risk.score,
    risk_level: risk.level,
    estimated_runtime_seconds,
    recommended_sequence,
    next_manual_step,
    warnings,
  };
}
