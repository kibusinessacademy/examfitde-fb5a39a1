import { describe, it, expect } from "vitest";

type Row = {
  test_priority: "critical" | "warning" | "healthy";
  latest_qa_status: "tested" | "issue_found" | "approved" | null;
  never_tested: boolean;
  updatedWithin3Days: boolean;
  qaFreshness: "never_tested" | "today" | "recent" | "stale";
};

function computeQueueScore(row: Row) {
  if (row.latest_qa_status === "issue_found" && row.qaFreshness !== "stale") return 120;
  if (row.test_priority === "critical" && row.never_tested) return 115;
  if (row.test_priority === "critical" && row.latest_qa_status === "tested") return 110;
  if (row.test_priority === "critical" && row.updatedWithin3Days) return 100;
  if (row.test_priority === "critical") return 90;

  if (row.test_priority === "warning" && row.never_tested) return 85;
  if (row.test_priority === "warning" && row.qaFreshness === "stale") return 80;
  if (row.test_priority === "warning" && row.updatedWithin3Days) return 70;
  if (row.test_priority === "warning") return 60;

  if (row.test_priority === "healthy" && row.never_tested) return 55;
  if (row.test_priority === "healthy" && row.qaFreshness === "stale") return 50;
  if (row.test_priority === "healthy" && row.updatedWithin3Days) return 40;

  if (row.latest_qa_status === "approved" && row.qaFreshness === "recent") return 10;

  return 20;
}

describe("QA feedback loop scoring", () => {
  it("issue_found outranks everything", () => {
    expect(
      computeQueueScore({
        test_priority: "healthy",
        latest_qa_status: "issue_found",
        never_tested: false,
        updatedWithin3Days: false,
        qaFreshness: "recent",
      })
    ).toBe(120);
  });

  it("critical and never tested is very high", () => {
    expect(
      computeQueueScore({
        test_priority: "critical",
        latest_qa_status: null,
        never_tested: true,
        updatedWithin3Days: false,
        qaFreshness: "never_tested",
      })
    ).toBe(115);
  });

  it("fresh approved course is deprioritized", () => {
    expect(
      computeQueueScore({
        test_priority: "healthy",
        latest_qa_status: "approved",
        never_tested: false,
        updatedWithin3Days: false,
        qaFreshness: "recent",
      })
    ).toBe(10);
  });

  it("warning stale qa is higher than generic warning", () => {
    expect(
      computeQueueScore({
        test_priority: "warning",
        latest_qa_status: "tested",
        never_tested: false,
        updatedWithin3Days: false,
        qaFreshness: "stale",
      })
    ).toBe(80);
  });

  it("healthy never tested is still visible", () => {
    expect(
      computeQueueScore({
        test_priority: "healthy",
        latest_qa_status: null,
        never_tested: true,
        updatedWithin3Days: false,
        qaFreshness: "never_tested",
      })
    ).toBe(55);
  });

  it("stale issue_found falls back to priority-based score", () => {
    expect(
      computeQueueScore({
        test_priority: "warning",
        latest_qa_status: "issue_found",
        never_tested: false,
        updatedWithin3Days: false,
        qaFreshness: "stale",
      })
    ).toBe(80);
  });

  it("critical tested recently gets 110", () => {
    expect(
      computeQueueScore({
        test_priority: "critical",
        latest_qa_status: "tested",
        never_tested: false,
        updatedWithin3Days: false,
        qaFreshness: "today",
      })
    ).toBe(110);
  });
});
