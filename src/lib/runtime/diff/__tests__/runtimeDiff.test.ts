import { describe, it, expect } from "vitest";
import { buildRuntimeDiff, summarizeRuntimeDiff, detectCriticalMutation } from "../runtimeDiff";

describe("runtimeDiff", () => {
  it("returns no changes for identical input", () => {
    const d = buildRuntimeDiff({ a: 1 }, { a: 1 });
    expect(d.entries).toEqual([]);
    expect(summarizeRuntimeDiff(d)).toBe("No changes");
  });

  it("is deterministic — same input twice yields byte-identical output", () => {
    const a = buildRuntimeDiff({ b: 2, a: 1 }, { a: 1, b: 3 });
    const b = buildRuntimeDiff({ a: 1, b: 2 }, { b: 3, a: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("flags published status change as critical", () => {
    const d = buildRuntimeDiff({ package: { status: "queued" } }, { package: { status: "published" } });
    expect(detectCriticalMutation(d)).toBe(true);
    expect(d.entries[0].kind).toBe("status_change");
  });

  it("redacts secret-like keys", () => {
    const d = buildRuntimeDiff({ token: "old" }, { token: "new" });
    expect(d.entries[0].after).toBe("[REDACTED]");
    expect(d.entries[0].before).toBe("[REDACTED]");
  });

  it("classifies queue/priority/retry/dag_unlock", () => {
    const d = buildRuntimeDiff(
      { queue_depth: 5, priority: 1, retry_count: 0, dag_state: "locked" },
      { queue_depth: 2, priority: 9, retry_count: 3, dag_state: "unlocked" },
    );
    const kinds = d.entries.map((e) => e.kind).sort();
    expect(kinds).toContain("queue_change");
    expect(kinds).toContain("priority_change");
    expect(kinds).toContain("retry_change");
    expect(kinds).toContain("dag_unlock");
  });
});
