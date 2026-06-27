/**
 * STORE.OPS.BATCH.OS.1 — Projection (pure).
 */
import type {
  BatchExecutionItemResult,
  BatchItem,
  BatchPlan,
  BatchProjection,
} from "./contracts.ts";
import { deriveStateFromItems } from "./batchState.ts";

export function projectBatch(
  plan: BatchPlan,
  results: BatchExecutionItemResult[],
  generated_at_reference: string,
): BatchProjection {
  const resultMap = new Map<string, BatchExecutionItemResult>();
  for (const r of results) {
    resultMap.set(`${r.manifest_id}::${r.action_type}`, r);
  }

  const items: BatchItem[] = plan.items.map((i) => {
    const r = resultMap.get(`${i.manifest_id}::${i.action_type}`);
    if (!r) return i;
    return {
      manifest_id: i.manifest_id,
      action_type: i.action_type,
      status: r.status,
      blockers: r.blockers ?? i.blockers,
    };
  });

  const total = items.length;
  const succeeded = items.filter((i) => i.status === "succeeded").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const blocked = items.filter((i) => i.status === "blocked").length;

  return {
    batch_id: plan.batch_id,
    state: deriveStateFromItems(items),
    items,
    total,
    succeeded,
    failed,
    skipped,
    blocked,
    generated_at_reference,
    warnings: plan.warnings,
  };
}
