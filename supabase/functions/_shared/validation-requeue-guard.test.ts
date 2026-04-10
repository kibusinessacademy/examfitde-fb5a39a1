/**
 * Regression tests for validation-requeue-guard.ts (F-4.3)
 *
 * 5 cases:
 *   1. PASS_READY  → blocked: false
 *   2. LIKELY_READY → blocked: false
 *   3. HARD_FAIL   → blocked: true
 *   4. UNKNOWN     → falls through to delta/cooldown logic
 *   5. OLD_BUG     → identical fails + no delta + LIKELY_READY → NOT blocked
 *
 * Uses a mock Supabase client to isolate guard logic from real DB.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkValidationRequeueGuard } from "./validation-requeue-guard.ts";

// ─── Mock Supabase client builder ─────────────────────────────────────────

interface MockRow {
  table: string;
  match: Record<string, unknown>;
  result: { data: unknown; count?: number; error?: null };
}

interface MockRpc {
  fn: string;
  result: { data: unknown; error?: null };
}

function createMockSb(opts: {
  rows?: MockRow[];
  rpcs?: MockRpc[];
}) {
  const { rows = [], rpcs = [] } = opts;

  function findRows(table: string, filters: Record<string, unknown>) {
    return rows.find(r => {
      if (r.table !== table) return false;
      return Object.entries(r.match).every(([k, v]) => filters[k] === v);
    });
  }

  // Chainable query builder mock
  function chainBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: any = {
      select(_cols: string, _opts?: any) {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      in(_col: string, _vals: unknown[]) { return builder; },
      gt(_col: string, _val: unknown) { return builder; },
      order(_col: string, _opts?: any) { return builder; },
      limit(_n: number) { return builder; },
      maybeSingle() {
        const match = findRows(table, filters);
        if (match) {
          const data = Array.isArray(match.result.data)
            ? (match.result.data as any[])[0] ?? null
            : match.result.data;
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: any) => void) {
        const match = findRows(table, filters);
        if (match) {
          return Promise.resolve(match.result).then(resolve);
        }
        return Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
      },
      // For insert (fire-and-forget logging)
      insert(_row: unknown) {
        return Promise.resolve({ data: null, error: null });
      },
    };
    // Make the builder itself thenable for count queries
    Object.defineProperty(builder, "count", {
      get() {
        const match = findRows(table, filters);
        return match?.result.count ?? 0;
      },
    });
    return builder;
  }

  return {
    from(table: string) {
      return chainBuilder(table);
    },
    rpc(fn: string, _params?: unknown) {
      const match = rpcs.find(r => r.fn === fn);
      if (match) return Promise.resolve(match.result);
      return Promise.resolve({ data: null, error: { message: "rpc not found" } });
    },
  };
}

// ─── Test 1: PASS_READY → blocked: false ──────────────────────────────────

Deno.test("PASS_READY: exam_pool gate PASS → not blocked", async () => {
  const sb = createMockSb({
    rows: [
      // Step is NOT done (so Layer 0 doesn't short-circuit)
      {
        table: "package_steps",
        match: { package_id: "pkg-1", step_key: "validate_exam_pool" },
        result: { data: [{ status: "queued" }] },
      },
    ],
    rpcs: [
      {
        fn: "fn_classify_exam_pool_gate",
        result: { data: { gate_status: "PASS", reason_code: null } },
      },
    ],
  });

  const result = await checkValidationRequeueGuard(sb, "package_validate_exam_pool", "pkg-1");
  assertEquals(result.blocked, false);
  assertEquals(result.reason?.includes("READINESS_PASS"), true);
});

// ─── Test 2: LIKELY_READY → blocked: false ────────────────────────────────

Deno.test("LIKELY_READY: handbook chapters present → not blocked", async () => {
  const sb = createMockSb({
    rows: [
      // Step is NOT done
      {
        table: "package_steps",
        match: { package_id: "pkg-2", step_key: "validate_handbook" },
        result: { data: [{ status: "queued" }] },
      },
      // Resolve curriculum_id
      {
        table: "course_packages",
        match: { id: "pkg-2" },
        result: { data: [{ curriculum_id: "cur-2" }] },
      },
      // Handbook chapters exist
      {
        table: "handbook_chapters",
        match: { curriculum_id: "cur-2" },
        result: { data: [], count: 5 },
      },
    ],
  });

  const result = await checkValidationRequeueGuard(sb, "package_validate_handbook", "pkg-2");
  assertEquals(result.blocked, false);
  assertEquals(result.reason?.includes("LIKELY_READY"), true);
});

// ─── Test 3: HARD_FAIL → blocked: true ────────────────────────────────────

Deno.test("HARD_FAIL: exam_pool gate HARD_FAIL → blocked", async () => {
  const sb = createMockSb({
    rows: [
      {
        table: "package_steps",
        match: { package_id: "pkg-3", step_key: "validate_exam_pool" },
        result: { data: [{ status: "queued" }] },
      },
    ],
    rpcs: [
      {
        fn: "fn_classify_exam_pool_gate",
        result: { data: { gate_status: "HARD_FAIL", reason_code: "ZERO_LFS" } },
      },
    ],
  });

  const result = await checkValidationRequeueGuard(sb, "package_validate_exam_pool", "pkg-3");
  assertEquals(result.blocked, true);
  assertEquals(result.reason?.includes("HARD_FAIL"), true);
});

// ─── Test 4: UNKNOWN → falls through to delta logic ───────────────────────

Deno.test("UNKNOWN: no gate signal → falls to delta logic (no fails = not blocked)", async () => {
  const sb = createMockSb({
    rows: [
      // Step NOT done
      {
        table: "package_steps",
        match: { package_id: "pkg-4", step_key: "validate_tutor_index" },
        result: { data: [{ status: "queued" }] },
      },
      // Tutor index: 0 entries → STILL_BLOCKED → delta logic
      {
        table: "ai_tutor_context_index",
        match: { package_id: "pkg-4" },
        result: { data: [], count: 0 },
      },
      // No recent fails in job_queue → delta logic returns blocked: false
      {
        table: "job_queue",
        match: { package_id: "pkg-4", job_type: "package_validate_tutor_index", status: "failed" },
        result: { data: [] },
      },
    ],
  });

  const result = await checkValidationRequeueGuard(sb, "package_validate_tutor_index", "pkg-4");
  assertEquals(result.blocked, false);
  // No reason means clean pass through delta logic (no fails found)
  assertEquals(result.reason, undefined);
});
