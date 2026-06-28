import { describe, it, expect } from "vitest";
import {
  AUDIT_ACTION_TO_REASON,
  buildDispatcherIdempotencyKey,
  classifyAuditAction,
  SILENT_DROP_REASON_CODES,
  type DispatcherSilentDropMetrics,
  type SilentDropReasonCode,
} from "../reasonCodes";

describe("PUBLISH.PIPELINE.GATE.OBSERVABILITY.OS.1 — reason codes", () => {
  it("maps every known BEFORE INSERT audit action to a reason code", () => {
    const expected: Array<[string, SilentDropReasonCode]> = [
      ["auto_publish_blocked_council_deferred", "COUNCIL_DEFERRED"],
      ["publish_enqueue_blocked_no_pricing", "PRICING_HARD_GATE_PRECONDITION"],
      ["bronze_locked_enqueue_blocked", "BRONZE_LOCKED_REQUIRES_REVIEW"],
      ["producer_source_missing_blocked", "PRODUCER_SOURCE_MISSING"],
      ["orphan_heal_phantom_blocked", "ORPHAN_HEAL_REQUIRES_BUILDING"],
      ["dag_guard_block", "DAG_PREREQUISITES_MISSING"],
      ["dag_guard_loop_detected", "DAG_GUARD_LOOP_DETECTED"],
    ];
    for (const [action, code] of expected) {
      expect(AUDIT_ACTION_TO_REASON[action]).toBe(code);
      expect(classifyAuditAction(action)).toBe(code);
    }
  });

  it("falls back to PUBLISH_GATE_BLOCKED for unknown / nullish actions", () => {
    expect(classifyAuditAction(null)).toBe("PUBLISH_GATE_BLOCKED");
    expect(classifyAuditAction(undefined)).toBe("PUBLISH_GATE_BLOCKED");
    expect(classifyAuditAction("some_new_unmapped_action")).toBe("PUBLISH_GATE_BLOCKED");
  });

  it("exposes a stable closed reason-code set", () => {
    // Guard against accidental enum drift; SSOT extension must update tests.
    expect([...SILENT_DROP_REASON_CODES].sort()).toEqual(
      [
        "BLOCKED_PUBLISH_NO_PRODUCT",
        "BRONZE_LOCKED_REQUIRES_REVIEW",
        "COUNCIL_DEFERRED",
        "DAG_GUARD_LOOP_DETECTED",
        "DAG_PREREQUISITES_MISSING",
        "ORPHAN_HEAL_REQUIRES_BUILDING",
        "PACKAGE_NOT_FOUND",
        "PRICING_HARD_GATE_PRECONDITION",
        "PRODUCER_SOURCE_MISSING",
        "PUBLISH_GATE_BLOCKED",
        "UNKNOWN_SILENT_DROP",
      ].sort(),
    );
  });
});

describe("PUBLISH.PIPELINE.GATE.OBSERVABILITY.OS.1 — 17-silent-drop classification", () => {
  // Reflects the observed Lane-C1 batch: 17 silent drops + 1 pricing-cancel.
  // Synthetic distribution used to lock the contract; real numbers can shift
  // but each row must map to a known reason via classifyAuditAction().
  const SILENT_DROP_BATCH: Array<{ id: string; auditAction: string | null }> = [
    { id: "pkg-01", auditAction: "auto_publish_blocked_council_deferred" },
    { id: "pkg-02", auditAction: "auto_publish_blocked_council_deferred" },
    { id: "pkg-03", auditAction: "auto_publish_blocked_council_deferred" },
    { id: "pkg-04", auditAction: "bronze_locked_enqueue_blocked" },
    { id: "pkg-05", auditAction: "bronze_locked_enqueue_blocked" },
    { id: "pkg-06", auditAction: "producer_source_missing_blocked" },
    { id: "pkg-07", auditAction: "producer_source_missing_blocked" },
    { id: "pkg-08", auditAction: "orphan_heal_phantom_blocked" },
    { id: "pkg-09", auditAction: "dag_guard_block" },
    { id: "pkg-10", auditAction: "dag_guard_block" },
    { id: "pkg-11", auditAction: "dag_guard_block" },
    { id: "pkg-12", auditAction: "dag_guard_loop_detected" },
    { id: "pkg-13", auditAction: "auto_publish_blocked_council_deferred" },
    { id: "pkg-14", auditAction: "bronze_locked_enqueue_blocked" },
    { id: "pkg-15", auditAction: null }, // unmapped → fallback
    { id: "pkg-16", auditAction: "auto_publish_blocked_council_deferred" },
    { id: "pkg-17", auditAction: "producer_source_missing_blocked" },
  ];

  it("classifies all 17 silent drops without throwing", () => {
    const classified = SILENT_DROP_BATCH.map((r) => classifyAuditAction(r.auditAction));
    expect(classified).toHaveLength(17);
    for (const code of classified) {
      expect(SILENT_DROP_REASON_CODES).toContain(code);
    }
  });

  it("produces a metrics rollup that sums back to the batch size", () => {
    const rollup: Partial<Record<SilentDropReasonCode, number>> = {};
    for (const row of SILENT_DROP_BATCH) {
      const code = classifyAuditAction(row.auditAction);
      rollup[code] = (rollup[code] ?? 0) + 1;
    }
    const total = Object.values(rollup).reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    expect(total).toBe(17);

    const metrics: DispatcherSilentDropMetrics = {
      dispatcher_enqueued: 0,
      dispatcher_failed: 0,
      dispatcher_silent_drops: SILENT_DROP_BATCH.length,
      dispatcher_silent_drop_reasons: rollup,
    };
    expect(metrics.dispatcher_silent_drops).toBe(17);
    expect(metrics.dispatcher_silent_drop_reasons.COUNCIL_DEFERRED).toBe(5);
    expect(metrics.dispatcher_silent_drop_reasons.BRONZE_LOCKED_REQUIRES_REVIEW).toBe(3);
    expect(metrics.dispatcher_silent_drop_reasons.PRODUCER_SOURCE_MISSING).toBe(3);
    expect(metrics.dispatcher_silent_drop_reasons.DAG_PREREQUISITES_MISSING).toBe(3);
    expect(metrics.dispatcher_silent_drop_reasons.DAG_GUARD_LOOP_DETECTED).toBe(1);
    expect(metrics.dispatcher_silent_drop_reasons.ORPHAN_HEAL_REQUIRES_BUILDING).toBe(1);
    expect(metrics.dispatcher_silent_drop_reasons.PUBLISH_GATE_BLOCKED).toBe(1);
  });

  it("classifies the pricing-hard-gate as PRICING_HARD_GATE_PRECONDITION (cancel-path, not silent-drop)", () => {
    // The pricing trigger does NOT return NULL — it sets status='cancelled'
    // and writes 'publish_enqueue_blocked_no_pricing'. The classifier still
    // maps that audit action to the canonical reason code.
    expect(classifyAuditAction("publish_enqueue_blocked_no_pricing")).toBe(
      "PRICING_HARD_GATE_PRECONDITION",
    );
  });
});

describe("PUBLISH.PIPELINE.GATE.OBSERVABILITY.OS.1 — idempotent audit-log key", () => {
  it("returns a stable key for the same (package_id, queue_id)", () => {
    const k1 = buildDispatcherIdempotencyKey("pkg-A", "q-1");
    const k2 = buildDispatcherIdempotencyKey("pkg-A", "q-1");
    expect(k1).toBe(k2);
    expect(k1).toBe("sellable_dispatcher_os1:pkg-A:q-1");
  });

  it("differs across queue items for the same package (no collisions)", () => {
    const k1 = buildDispatcherIdempotencyKey("pkg-A", "q-1");
    const k2 = buildDispatcherIdempotencyKey("pkg-A", "q-2");
    expect(k1).not.toBe(k2);
  });

  it("differs across packages for the same queue id", () => {
    expect(buildDispatcherIdempotencyKey("pkg-A", "q-1")).not.toBe(
      buildDispatcherIdempotencyKey("pkg-B", "q-1"),
    );
  });
});
