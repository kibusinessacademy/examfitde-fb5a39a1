/**
 * Tests for shard-aware liveness verdict logic.
 *
 * We test the pure `deriveVerdict` logic by importing the module internals.
 * Since deriveVerdict is not exported, we replicate the logic here as a unit test.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── Replicate verdict derivation for unit testing ──
type ShardLivenessVerdict =
  | "healthy_active"
  | "healthy_idle"
  | "shard_orphaned"
  | "parent_only_active"
  | "fully_idle"
  | "stalled";

function deriveVerdict(
  parent: { pending: number; processing: number; failed: number },
  shardJobs: { pending: number; processing: number; failed: number },
  shardTable: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
    last_activity_at: string | null;
  },
  graceWindowMinutes = 15,
): { verdict: ShardLivenessVerdict; is_deadlocked: boolean } {
  const parentActive = parent.pending + parent.processing > 0;
  const shardJobsActive = shardJobs.pending + shardJobs.processing > 0;
  const shardsPendingOrProcessing = shardTable.pending + shardTable.processing;
  const hasShards = shardTable.total > 0;

  if (shardJobsActive) {
    return { verdict: "healthy_active", is_deadlocked: false };
  }
  if (parentActive && !hasShards) {
    return { verdict: "parent_only_active", is_deadlocked: false };
  }
  if (hasShards && shardsPendingOrProcessing === 0) {
    return { verdict: "healthy_idle", is_deadlocked: false };
  }
  if (shardsPendingOrProcessing > 0 && !shardJobsActive) {
    if (shardTable.last_activity_at) {
      const lastActivity = new Date(shardTable.last_activity_at).getTime();
      const graceMs = graceWindowMinutes * 60_000;
      if (Date.now() - lastActivity < graceMs) {
        return { verdict: "stalled", is_deadlocked: false };
      }
    }
    return { verdict: "shard_orphaned", is_deadlocked: true };
  }
  if (!hasShards && !parentActive) {
    return { verdict: "fully_idle", is_deadlocked: false };
  }
  return { verdict: "healthy_active", is_deadlocked: false };
}

// ── Test Cases ──

Deno.test("TC1: Parent-Job missing but active shard-jobs exist → healthy_active", () => {
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 3, processing: 1, failed: 0 },
    { pending: 5, processing: 1, completed: 2, failed: 0, total: 8, last_activity_at: new Date().toISOString() },
  );
  assertEquals(result.verdict, "healthy_active");
  assertEquals(result.is_deadlocked, false);
});

Deno.test("TC2: Pending shards, no active shard-jobs, past grace → shard_orphaned (DEADLOCK)", () => {
  const oldTime = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min ago
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, failed: 2 },
    { pending: 5, processing: 0, completed: 3, failed: 0, total: 8, last_activity_at: oldTime },
  );
  assertEquals(result.verdict, "shard_orphaned");
  assertEquals(result.is_deadlocked, true);
});

Deno.test("TC3: All shards done, no active jobs → healthy_idle (ready for finalize)", () => {
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, completed: 10, failed: 2, total: 12, last_activity_at: new Date().toISOString() },
  );
  assertEquals(result.verdict, "healthy_idle");
  assertEquals(result.is_deadlocked, false);
});

Deno.test("TC4: Pending shards, active jobs, fresh activity → healthy_active", () => {
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 2, processing: 1, failed: 0 },
    { pending: 4, processing: 1, completed: 3, failed: 0, total: 8, last_activity_at: new Date().toISOString() },
  );
  assertEquals(result.verdict, "healthy_active");
  assertEquals(result.is_deadlocked, false);
});

Deno.test("TC5: No shards, no jobs → fully_idle", () => {
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, completed: 0, failed: 0, total: 0, last_activity_at: null },
  );
  assertEquals(result.verdict, "fully_idle");
  assertEquals(result.is_deadlocked, false);
});

Deno.test("TC6: Pending shards, no jobs, within grace window → stalled (not yet deadlocked)", () => {
  const recentTime = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, failed: 0 },
    { pending: 3, processing: 0, completed: 5, failed: 0, total: 8, last_activity_at: recentTime },
  );
  assertEquals(result.verdict, "stalled");
  assertEquals(result.is_deadlocked, false);
});

Deno.test("TC7: Parent active, no shards yet → parent_only_active (pre-fanout)", () => {
  const result = deriveVerdict(
    { pending: 1, processing: 0, failed: 0 },
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, completed: 0, failed: 0, total: 0, last_activity_at: null },
  );
  assertEquals(result.verdict, "parent_only_active");
  assertEquals(result.is_deadlocked, false);
});

Deno.test("TC8: Pending shards, no jobs, null last_activity → shard_orphaned (no grace)", () => {
  const result = deriveVerdict(
    { pending: 0, processing: 0, failed: 0 },
    { pending: 0, processing: 0, failed: 0 },
    { pending: 5, processing: 0, completed: 0, failed: 0, total: 5, last_activity_at: null },
  );
  assertEquals(result.verdict, "shard_orphaned");
  assertEquals(result.is_deadlocked, true);
});
