import { describe, it, expect } from "vitest";
import {
  canTransition,
  nextStatusOptions,
  isTerminal,
  computePriority,
  classifyFollowup,
  normalizeFilters,
  validateActivityDraft,
  scrubForAudit,
  sortByPriorityThenScore,
  LEAD_STATUSES,
  type SalesLeadListItem,
} from "@/lib/foerdermittel/salesInbox";

describe("salesInbox — status flow", () => {
  it("is forward-only", () => {
    expect(canTransition("new", "qualified")).toBe(true);
    expect(canTransition("new", "won")).toBe(true);
    expect(canTransition("qualified", "new")).toBe(false);
    expect(canTransition("contacted", "qualified")).toBe(false);
    expect(canTransition("won", "lost")).toBe(false);
    expect(canTransition("lost", "new")).toBe(false);
    expect(canTransition("new", "new")).toBe(false);
  });

  it("lost reachable from any non-terminal", () => {
    for (const s of LEAD_STATUSES) {
      if (s === "won" || s === "lost") continue;
      expect(canTransition(s, "lost")).toBe(true);
    }
  });

  it("nextStatusOptions returns only valid forward states", () => {
    expect(nextStatusOptions("new")).toEqual(["qualified", "contacted", "won", "lost"]);
    expect(nextStatusOptions("won")).toEqual([]);
  });

  it("isTerminal", () => {
    expect(isTerminal("won")).toBe(true);
    expect(isTerminal("lost")).toBe(true);
    expect(isTerminal("new")).toBe(false);
  });
});

describe("salesInbox — priority", () => {
  const now = new Date("2026-05-26T10:00:00Z");

  it("overdue followup is P0", () => {
    expect(computePriority({
      status: "qualified", tier: "cold", score: 10,
      nextActionAt: "2026-05-20T10:00:00Z", createdAt: "2026-05-01T10:00:00Z", now,
    })).toBe("p0");
  });

  it("hot tier is P0", () => {
    expect(computePriority({
      status: "new", tier: "hot", score: 80,
      nextActionAt: null, createdAt: "2026-05-25T10:00:00Z", now,
    })).toBe("p0");
  });

  it("score>=70 is P1", () => {
    expect(computePriority({
      status: "new", tier: "warm", score: 75,
      nextActionAt: null, createdAt: "2026-05-25T10:00:00Z", now,
    })).toBe("p1");
  });

  it("terminal is P3", () => {
    expect(computePriority({
      status: "won", tier: "hot", score: 99,
      nextActionAt: null, createdAt: "2026-05-25T10:00:00Z", now,
    })).toBe("p3");
  });
});

describe("salesInbox — followup classification", () => {
  const now = new Date("2026-05-26T10:00:00Z");
  it("classifies correctly", () => {
    expect(classifyFollowup(null, now)).toBe("none");
    expect(classifyFollowup("2026-05-25T10:00:00Z", now)).toBe("overdue");
    expect(classifyFollowup("2026-05-26T20:00:00Z", now)).toBe("today");
    expect(classifyFollowup("2026-05-29T10:00:00Z", now)).toBe("soon");
    expect(classifyFollowup("2026-06-10T10:00:00Z", now)).toBe("scheduled");
  });
});

describe("salesInbox — filter normalization", () => {
  it("drops empty + caps lengths", () => {
    expect(normalizeFilters({ search: "a" })).toEqual({});
    expect(normalizeFilters({ status: ["new", "bogus" as any] })).toEqual({ status: ["new"] });
    expect(normalizeFilters({ status: ["bogus" as any] })).toEqual({});
    const long = normalizeFilters({ search: "x".repeat(200) });
    expect((long.search ?? "").length).toBe(80);
  });
});

describe("salesInbox — activity validation", () => {
  it("rejects invalid kind, empty note", () => {
    expect(validateActivityDraft({ kind: "bogus" as any, note: "ok ok" }).ok).toBe(false);
    expect(validateActivityDraft({ kind: "note", note: "" }).ok).toBe(false);
  });
  it("requires next_action_at for followup", () => {
    const r = validateActivityDraft({ kind: "followup", note: "call back" });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("next_action_at_required");
  });
  it("accepts valid note", () => {
    const r = validateActivityDraft({ kind: "note", note: "Called, no answer" });
    expect(r.ok).toBe(true);
    expect(r.cleaned?.note).toBe("Called, no answer");
  });
});

describe("salesInbox — PII scrub", () => {
  it("strips emails, phones, IBAN-like, and block-keys", () => {
    const r = scrubForAudit({
      email: "max@firma.de",
      reason: "Call max@firma.de at +49 30 12345678 IBAN DE89 3704 0044 0532 0130 00",
      lead_id: "abc",
    });
    expect(r.email).toBeUndefined();
    expect(String(r.reason)).not.toContain("max@firma.de");
    expect(String(r.reason)).toContain("[redacted-email]");
    expect(String(r.reason)).toContain("[redacted-phone]");
    expect(r.lead_id).toBe("abc");
  });
});

describe("salesInbox — sortByPriorityThenScore", () => {
  const base: SalesLeadListItem = {
    id: "1", company_name: "X", contact_email: "x@x.de", industry: null,
    source: "foerdermittel:hub", status: "new", tags: [], created_at: "2026-05-25T10:00:00Z",
    updated_at: "2026-05-25T10:00:00Z", next_action: null, next_action_at: null, assigned_to: null,
    score: 50, tier: "warm", region: "BY", source_page: "hub", report_top_slugs: [], report_readiness: null,
  };
  it("p0 overdue before high-score warm", () => {
    const sorted = sortByPriorityThenScore([
      { ...base, id: "a", score: 90, tier: "warm" },
      { ...base, id: "b", score: 20, tier: "cold", next_action_at: "2020-01-01T00:00:00Z", status: "qualified" },
    ]);
    expect(sorted[0].id).toBe("b");
  });
});
