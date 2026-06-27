/**
 * STORE.OPS.BATCH.OS.1 — Plan builder (pure, deterministic).
 */
import type {
  BatchActionType,
  BatchItem,
  BatchPlan,
  BatchPlanInput,
} from "./contracts.ts";
import { checkApplicability, filterAllowedActions } from "./batchPolicy.ts";

export function planBatch(input: BatchPlanInput): BatchPlan {
  const warnings: string[] = [];

  const { allowed, rejected } = filterAllowedActions(input.selected_action_types);
  for (const r of rejected) {
    warnings.push(`Aktion verboten oder unbekannt: ${r}`);
  }

  const manifestIds = [...new Set(input.manifest_ids)].sort();
  const actions = [...new Set(allowed)].sort() as BatchActionType[];

  const items: BatchItem[] = [];
  for (const manifest_id of manifestIds) {
    for (const action_type of actions) {
      const blockers = checkApplicability(manifest_id, action_type, input);
      items.push({
        manifest_id,
        action_type,
        status: blockers.length > 0 ? "blocked" : "planned",
        blockers,
      });
    }
  }

  return {
    batch_id: input.batch_id,
    planned_at_reference: input.planned_at_reference,
    items,
    skipped_action_types: rejected as BatchActionType[],
    warnings,
  };
}
