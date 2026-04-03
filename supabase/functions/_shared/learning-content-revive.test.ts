/**
 * Tests for shard-aware liveness verdict logic (v2 — hardened).
 *
 * Tests the pure verdict derivation + cooldown/grace semantics.
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
    claimed: number;
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
  const shardsUnfinished = shardTable.pending + shardTable.claimed + shardTable.processing;
  const hasShards = shardTable.total > 0;

  if (shardJobsActive) return { verdict: "healthy_active", is_deadlocked: false };
  if (parentActive && !hasShards) return { verdict: "parent_only_active", is_deadlocked: false };
  if (hasShards && shardsUnfinished === 0) return { verdict: "healthy_idle", is_deadlocked: false };
  if (shardsUnfinished > 0 && !shardJobsActive) {
    if (shardTable.last_activity_at) {
      const lastActivity = new Date(shardTable.last_activity_at).getTime();
      const graceMs = graceWindowMinutes * 60_000;
      if (Date.now() - lastActivity < graceMs) return { verdict: "stalled", is_deadlocked: false };
    }
    return { verdict: "shard_orphaned", is_deadlocked: true };
  }
  if (!hasShards && !parentActive) return { verdict: "fully_idle", is_deadlocked: false };
  return { verdict: "healthy_active", is_deadlocked: false };
}

const noParent = { pending: 0, processing: 0, failed: 0 };
const noShardJobs = { pending: 0, processing: 0, failed: 0 };
const emptyShards = { pending: 0, claimed: 0, processing: 0, completed: 0, failed: 0, total: 0, last_activity_at: null };

// ── Test Cases ──

Deno.test("TC1: Active shard-jobs → healthy_active", () => {
  const r = deriveVerdict(noParent, { pending: 3, processing: 1, failed: 0 },
    { pending: 5, claimed: 0, processing: 1, completed: 2, failed: 0, total: 8, last_activity_at: new Date().toISOString() });
  assertEquals(r.verdict, "healthy_active");
  assertEquals(r.is_deadlocked, false);
});

Deno.test("TC2: Pending shards, no shard-jobs, past grace → shard_orphaned", () => {
  const old = new Date(Date.now() - 30 * 60_000).toISOString();
  const r = deriveVerdict(noParent, { pending: 0, processing: 0, failed: 2 },
    { pending: 5, claimed: 0, processing: 0, completed: 3, failed: 0, total: 8, last_activity_at: old });
  assertEquals(r.verdict, "shard_orphaned");
  assertEquals(r.is_deadlocked, true);
});

Deno.test("TC3: All shards done → healthy_idle", () => {
  const r = deriveVerdict(noParent, noShardJobs,
    { pending: 0, claimed: 0, processing: 0, completed: 10, failed: 2, total: 12, last_activity_at: new Date().toISOString() });
  assertEquals(r.verdict, "healthy_idle");
  assertEquals(r.is_deadlocked, false);
});

Deno.test("TC4: Active shard-jobs, fresh activity → healthy_active", () => {
  const r = deriveVerdict(noParent, { pending: 2, processing: 1, failed: 0 },
    { pending: 4, claimed: 1, processing: 1, completed: 3, failed: 0, total: 9, last_activity_at: new Date().toISOString() });
  assertEquals(r.verdict, "healthy_active");
  assertEquals(r.is_deadlocked, false);
});

Deno.test("TC5: No shards, no jobs → fully_idle", () => {
  const r = deriveVerdict(noParent, noShardJobs, emptyShards);
  assertEquals(r.verdict, "fully_idle");
  assertEquals(r.is_deadlocked, false);
});

Deno.test("TC6: Pending shards, no jobs, within grace → stalled", () => {
  const recent = new Date(Date.now() - 5 * 60_000).toISOString();
  const r = deriveVerdict(noParent, noShardJobs,
    { pending: 3, claimed: 0, processing: 0, completed: 5, failed: 0, total: 8, last_activity_at: recent });
  assertEquals(r.verdict, "stalled");
  assertEquals(r.is_deadlocked, false);
});

Deno.test("TC7: Parent active, no shards → parent_only_active", () => {
  const r = deriveVerdict({ pending: 1, processing: 0, failed: 0 }, noShardJobs, emptyShards);
  assertEquals(r.verdict, "parent_only_active");
  assertEquals(r.is_deadlocked, false);
});

Deno.test("TC8: Null last_activity + pending shards → shard_orphaned (no grace)", () => {
  const r = deriveVerdict(noParent, noShardJobs,
    { pending: 5, claimed: 0, processing: 0, completed: 0, failed: 0, total: 5, last_activity_at: null });
  assertEquals(r.verdict, "shard_orphaned");
  assertEquals(r.is_deadlocked, true);
});

Deno.test("TC9: Claimed shards with no jobs, past grace → shard_orphaned", () => {
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  const r = deriveVerdict(noParent, noShardJobs,
    { pending: 0, claimed: 3, processing: 0, completed: 5, failed: 0, total: 8, last_activity_at: old });
  assertEquals(r.verdict, "shard_orphaned");
  assertEquals(r.is_deadlocked, true);
});

Deno.test("TC10: All completed + claimed=0, pending=0 → healthy_idle (not deadlock)", () => {
  const r = deriveVerdict(noParent, noShardJobs,
    { pending: 0, claimed: 0, processing: 0, completed: 12, failed: 0, total: 12, last_activity_at: new Date().toISOString() });
  assertEquals(r.verdict, "healthy_idle");
  assertEquals(r.is_deadlocked, false);
});
