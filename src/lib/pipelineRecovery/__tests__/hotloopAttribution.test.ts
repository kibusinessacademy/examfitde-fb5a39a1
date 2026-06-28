import { describe, it, expect } from "vitest";
import {
  pickJobsNeedingAttribution,
  countHotloopCancelsForQuarantined,
  isHotloopCancel,
} from "../hotloopAttribution";

const Q = new Set(["pkg-a", "pkg-b"]);

describe("OS.3.1 hotloop attribution (pure)", () => {
  it("recognises AUTO_HOTLOOP_QUARANTINE substrings", () => {
    expect(isHotloopCancel("| AUTO_HOTLOOP_QUARANTINE:OTHER")).toBe(true);
    expect(isHotloopCancel("AUTO_HOTLOOP_QUARANTINE:CHILD_FAILED")).toBe(true);
    expect(isHotloopCancel("PARKED_AWAITING_CHILDREN")).toBe(false);
    expect(isHotloopCancel(null)).toBe(false);
  });

  it("selects only hotloop-cancelled jobs whose package is in quarantine", () => {
    const picked = pickJobsNeedingAttribution(
      [
        { id: "j1", package_id: "pkg-a", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" },
        { id: "j2", package_id: "pkg-c", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" }, // not quarantined
        { id: "j3", package_id: "pkg-b", cancel_reason: "some other reason" },        // not hotloop
        { id: "j4", package_id: null,    cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" }, // no pkg
      ],
      [],
      Q,
    );
    expect(picked.map((p) => p.id)).toEqual(["j1"]);
  });

  it("never emits twice for the same job (existing worker-gate log wins)", () => {
    const picked = pickJobsNeedingAttribution(
      [
        { id: "j1", package_id: "pkg-a", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" },
        { id: "j2", package_id: "pkg-b", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:Y" },
      ],
      [{ job_id: "j1" }], // already attributed by worker gate or prior pass
      Q,
    );
    expect(picked.map((p) => p.id)).toEqual(["j2"]);
  });

  it("dedupes within a single candidate batch", () => {
    const picked = pickJobsNeedingAttribution(
      [
        { id: "j1", package_id: "pkg-a", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" },
        { id: "j1", package_id: "pkg-a", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" },
      ],
      [],
      Q,
    );
    expect(picked).toHaveLength(1);
  });

  it("count KPI matches selection semantics (no double-count)", () => {
    const candidates = [
      { id: "j1", package_id: "pkg-a", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" },
      { id: "j1", package_id: "pkg-a", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:X" }, // dup
      { id: "j2", package_id: "pkg-b", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:Y" },
      { id: "j3", package_id: "pkg-c", cancel_reason: "AUTO_HOTLOOP_QUARANTINE:Y" }, // not quarantined
      { id: "j4", package_id: "pkg-b", cancel_reason: "PARKED" },                    // not hotloop
    ];
    expect(countHotloopCancelsForQuarantined(candidates, Q)).toBe(2);
  });
});
