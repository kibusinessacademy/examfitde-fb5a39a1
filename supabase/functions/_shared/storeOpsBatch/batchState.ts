/**
 * STORE.OPS.BATCH.OS.1 — State machine (pure).
 */
import type { BatchItem, BatchState } from "./contracts.ts";

export const ALLOWED_TRANSITIONS: Record<BatchState, BatchState[]> = {
  draft: ["planned", "cancelled"],
  planned: ["running", "cancelled", "blocked"],
  running: ["partially_completed", "completed", "blocked", "cancelled"],
  partially_completed: ["running", "completed", "cancelled"],
  completed: [],
  blocked: ["planned", "cancelled"],
  cancelled: [],
};

export function canTransition(from: BatchState, to: BatchState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function deriveStateFromItems(items: BatchItem[]): BatchState {
  if (items.length === 0) return "draft";
  const running = items.some((i) => i.status === "running");
  if (running) return "running";

  const succeeded = items.filter((i) => i.status === "succeeded").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const planned = items.filter((i) => i.status === "planned").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const terminal = succeeded + failed + skipped;

  if (planned > 0) return "planned";
  if (blocked === items.length) return "blocked";
  if (terminal === items.length && failed === 0) return "completed";
  if (terminal > 0) return "partially_completed";
  return "planned";
}
