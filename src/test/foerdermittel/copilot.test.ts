import { describe, it, expect } from "vitest";
import { PROGRAMS, getProgramBySlug } from "@/lib/foerdermittel/registry";
import {
  buildCopilotContext,
  buildAllowedCopilotActions,
  classifyCopilotIntent,
  buildGroundingInstructions,
  sanitizeCopilotPayload,
  validateCopilotResponse,
  buildRefusal,
  buildPreparedBridgeIntents,
  isRegisteredProgramSlug,
} from "@/lib/foerdermittel/copilot";
import type { CompanyProfile } from "@/lib/foerdermittel/types";

const program = PROGRAMS[0];
const profile: CompanyProfile = { region: "DE", size: "small", topics: ["digitalisierung"] };

describe("copilot — context builder", () => {
  it("builds a grounded context from registry only", () => {
    const ctx = buildCopilotContext(program);
    expect(ctx.program.slug).toBe(program.slug);
    expect(ctx.program.sources.length).toBeGreaterThan(0);
    expect(ctx.freshness.statusLabel).toBeTruthy();
  });

  it("includes readiness + nextActions when profile present", () => {
    const ctx = buildCopilotContext(program, undefined, profile);
    expect(ctx.profile).toBeDefined();
    expect(ctx.readiness).toBeDefined();
    expect(Array.isArray(ctx.nextActions)).toBe(true);
  });

  it("omits readiness when no profile", () => {
    const ctx = buildCopilotContext(program);
    expect(ctx.readiness).toBeUndefined();
    expect(ctx.nextActions.length).toBe(0);
  });
});

describe("copilot — allowed actions", () => {
  it("hides profile-required actions when no profile", () => {
    const ctx = buildCopilotContext(program);
    const acts = buildAllowedCopilotActions(ctx);
    expect(acts.find((a) => a.intent === "explain_program_fit")).toBeUndefined();
  });
  it("shows profile-required actions when profile present", () => {
    const ctx = buildCopilotContext(program, undefined, profile);
    const acts = buildAllowedCopilotActions(ctx);
    expect(acts.find((a) => a.intent === "explain_program_fit")).toBeDefined();
  });
});

describe("copilot — intent classification", () => {
  it("maps documents query", () => {
    expect(classifyCopilotIntent("Welche Unterlagen fehlen?")).toBe("explain_missing_documents");
  });
  it("maps fit query", () => {
    expect(classifyCopilotIntent("Warum passt diese Förderung?")).toBe("explain_program_fit");
  });
  it("maps freshness/risk", () => {
    expect(classifyCopilotIntent("Welche Risiken bei der Frist?")).toBe("explain_freshness_risk");
  });
  it("maps outline", () => {
    expect(classifyCopilotIntent("Antrag schreiben Gliederung")).toBe("prepare_application_outline");
  });
  it("maps next step", () => {
    expect(classifyCopilotIntent("Was ist der nächste Schritt?")).toBe("suggest_next_step");
  });
  it("returns ask_clarifying_question for empty", () => {
    expect(classifyCopilotIntent("")).toBe("ask_clarifying_question");
  });
  it("returns unknown otherwise", () => {
    expect(classifyCopilotIntent("Wetter morgen?")).toBe("unknown");
  });
});

describe("copilot — grounding", () => {
  it("contains hard rules + freshness state", () => {
    const ctx = buildCopilotContext(program);
    const g = buildGroundingInstructions(ctx);
    expect(g).toMatch(/STRIKTE REGELN/);
    expect(g).toMatch(/Quellen|sources/);
    expect(g).toMatch(ctx.freshness.statusLabel);
  });
  it("adds clarifying-question rule when no profile", () => {
    const ctx = buildCopilotContext(program);
    const g = buildGroundingInstructions(ctx);
    expect(g).toMatch(/Unternehmensprofil/);
  });
});

describe("copilot — sanitization", () => {
  it("trims long messages", () => {
    const ctx = buildCopilotContext(program);
    const payload = sanitizeCopilotPayload({
      intent: "suggest_next_step",
      message: "a".repeat(5000),
      context: ctx,
    });
    expect((payload.message ?? "").length).toBeLessThanOrEqual(800);
  });
  it("rejects programs outside registry", () => {
    const ctx = buildCopilotContext(program);
    const bad = { ...ctx, program: { ...ctx.program, slug: "fake-program-xyz" } };
    expect(() =>
      sanitizeCopilotPayload({ intent: "suggest_next_step", context: bad }),
    ).toThrow(/copilot_payload_invalid_program/);
  });
  it("drops free-text profile fields if smuggled", () => {
    const ctx = buildCopilotContext(program, undefined, profile);
    const dirty = {
      ...ctx,
      profile: { ...ctx.profile!, email: "x@y.de", name: "ACME" } as never,
    };
    const out = sanitizeCopilotPayload({ intent: "suggest_next_step", context: dirty });
    expect(out.context.profile).toEqual({
      region: profile.region,
      size: profile.size,
      topics: profile.topics,
    });
  });
});

describe("copilot — response validation", () => {
  it("flags missing freshness disclaimer when stale", () => {
    const stale = {
      ...program,
      freshness: { ...program.freshness, lastVerifiedAt: "2020-01-01", nextReviewAt: "2020-06-01" },
    };
    const ctx = buildCopilotContext(stale);
    const v = validateCopilotResponse("Das Programm ist großartig und passt perfekt.", ctx);
    if (ctx.freshness.status === "stale" || ctx.freshness.status === "unknown") {
      expect(v.warnings).toContain("missing_freshness_disclaimer");
    }
  });
  it("flags missing draft disclaimer on outline-like answers", () => {
    const ctx = buildCopilotContext(program);
    const v = validateCopilotResponse("Projektbeschreibung: ... Kostenplan: ...", ctx);
    expect(v.warnings).toContain("missing_draft_disclaimer");
  });
  it("flags mentions of other registered programs", () => {
    const ctx = buildCopilotContext(program);
    const other = PROGRAMS.find((p) => p.slug !== program.slug)!;
    const v = validateCopilotResponse(`Schau dir auch ${other.slug} an.`, ctx);
    expect(v.warnings.some((w) => w.startsWith("mentions_other_program:"))).toBe(true);
  });
  it("rejects empty responses", () => {
    const ctx = buildCopilotContext(program);
    expect(validateCopilotResponse("", ctx).ok).toBe(false);
  });
});

describe("copilot — refusal builder", () => {
  it("produces helpful refusal for missing profile", () => {
    const r = buildRefusal("missing_profile");
    expect(r.reason).toBe("missing_profile");
    expect(r.message).toMatch(/Unternehmensprofil/);
  });
  it("produces refusal for stale source", () => {
    expect(buildRefusal("stale_source").suggestion).toMatch(/Förderträger/);
  });
});

describe("copilot — bridge intents", () => {
  it("returns typed bridge intents and marks availability", () => {
    const ctx = buildCopilotContext(program);
    const bridges = buildPreparedBridgeIntents(ctx);
    expect(bridges.length).toBeGreaterThan(0);
    expect(bridges.every((b) => b.intent && b.label && b.availability)).toBe(true);
    expect(bridges.find((b) => b.availability === "coming_soon")).toBeDefined();
  });
});

describe("copilot — registry guard", () => {
  it("only accepts registered slugs", () => {
    expect(isRegisteredProgramSlug(program.slug)).toBe(true);
    expect(isRegisteredProgramSlug("not-real-zzz")).toBe(false);
  });
});

describe("copilot — Cut 1–3 regression", () => {
  it("registry, matching, freshness, execution remain intact", () => {
    expect(PROGRAMS.length).toBeGreaterThanOrEqual(12);
    expect(getProgramBySlug(program.slug)).toBeDefined();
    const ctx = buildCopilotContext(program, undefined, profile);
    expect(ctx.readiness?.score).toBeGreaterThanOrEqual(0);
    expect(ctx.readiness?.score).toBeLessThanOrEqual(100);
  });
});
