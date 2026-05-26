/**
 * P71 — Agent Artifact Premium Layer: Contract Tests
 *
 * Static guarantees against drift of the artifact resolver, evidence chain,
 * export helpers and Drawer wiring. Pure unit tests — no DB, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyArtifact,
  buildArtifactPreview,
  buildEvidenceChain,
  exportArtifactAsJson,
  exportArtifactAsMarkdown,
  ARTIFACT_REGISTRY,
  type ArtifactType,
} from "@/lib/governance/backgroundAgentArtifacts";
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";

const ROOT = resolve(__dirname, "../..");
const RESOLVER_PATH = resolve(ROOT, "lib/governance/backgroundAgentArtifacts.ts");
const DRAWER_PATH = resolve(ROOT, "components/governance/ArtifactPreviewDrawer.tsx");
const COCKPIT_PATH = resolve(ROOT, "pages/admin/governance/BackgroundAgentRuntimePage.tsx");

function task(partial: Partial<BackgroundTaskLike> & { meta?: Record<string, unknown> | null }): BackgroundTaskLike {
  return {
    source_type: "job_queue",
    source_id: "00000000-0000-0000-0000-000000000000",
    status: "completed",
    risk_level: "low",
    approval_state: "not_required",
    artifact_count: 1,
    package_id: null,
    capability_summary: null,
    ...partial,
  } as BackgroundTaskLike;
}

describe("P71 — artifact registry", () => {
  it("exposes all 7 customer-facing artifact types + unknown fallback", () => {
    const expected: ArtifactType[] = [
      "report",
      "checklist",
      "finding",
      "diff_plan",
      "seo_brief",
      "compliance_evidence",
      "quality_plan",
      "unknown",
    ];
    for (const t of expected) {
      expect(ARTIFACT_REGISTRY[t]).toBeDefined();
      expect(ARTIFACT_REGISTRY[t].label.length).toBeGreaterThan(0);
    }
  });

  it("never exposes 'curriculum repair' or 'council' wording in customer labels", () => {
    for (const [k, d] of Object.entries(ARTIFACT_REGISTRY)) {
      if (k === "unknown") continue;
      expect(d.label.toLowerCase(), `${k}.label`).not.toMatch(/curriculum[_\s-]?repair/);
      expect(d.label.toLowerCase(), `${k}.label`).not.toMatch(/council/);
      expect(d.description.toLowerCase(), `${k}.description`).not.toMatch(/curriculum[_\s-]?repair/);
    }
  });
});

describe("P71 — classifier", () => {
  it.each<[string, BackgroundTaskLike, ArtifactType]>([
    ["explicit meta hint wins", task({ meta: { artifact_type: "checklist" }, capability_summary: "SEO Brief generieren" }), "checklist"],
    ["seo_brief from summary", task({ capability_summary: "SEO Opportunity Scan ausführen" }), "seo_brief"],
    ["compliance_evidence", task({ capability_summary: "DSGVO Audit Export" }), "compliance_evidence"],
    ["checklist", task({ capability_summary: "Maßnahmen-Checklist generieren" }), "checklist"],
    ["diff_plan", task({ capability_summary: "Dry-run patch preview" }), "diff_plan"],
    ["finding", task({ capability_summary: "Drift Finding aggregieren" }), "finding"],
    ["quality_plan", task({ capability_summary: "Curriculum integrity repair plan" }), "quality_plan"],
    ["fallback to report when artifact present", task({ capability_summary: "Custom job", artifact_count: 2 }), "report"],
    ["unknown when no artifact + no signal", task({ capability_summary: "Custom job", artifact_count: 0 }), "unknown"],
  ])("classifies %s", (_name, t, expected) => {
    expect(classifyArtifact(t)).toBe(expected);
  });

  it("is pure and deterministic", () => {
    const t = task({ capability_summary: "SEO Cluster Gap" });
    expect(classifyArtifact(t)).toBe(classifyArtifact(t));
  });
});

describe("P71 — artifact preview", () => {
  it("returns isEmpty=true with customer-safe summary when no artifact + no meta", () => {
    const p = buildArtifactPreview(task({ artifact_count: 0, meta: null, status: "running" }));
    expect(p.isEmpty).toBe(true);
    expect(p.summary).toMatch(/läuft|nach Abschluss/i);
    expect(p.sections).toHaveLength(0);
  });

  it("projects meta into stable, alphabetically sorted sections", () => {
    const p = buildArtifactPreview(
      task({
        meta: { zeta: "last", alpha: "first", findings: ["a", "b"] },
        capability_summary: "Compliance Scan",
      }),
    );
    const headings = p.sections.map((s) => s.heading);
    expect(headings).toEqual(["alpha", "findings", "zeta"]);
    expect(p.isEmpty).toBe(false);
  });

  it("redacts secret-like keys", () => {
    const p = buildArtifactPreview(
      task({ meta: { api_key: "sk-xxx", note: "ok" }, capability_summary: "Export" }),
    );
    const apiKeySection = p.sections.find((s) => s.heading === "api_key");
    expect(apiKeySection?.body).toBe("[redacted]");
  });
});

describe("P71 — evidence chain", () => {
  it("always returns 4 ordered steps: source → action → artifact → audit", () => {
    const chain = buildEvidenceChain(task({ capability_summary: "X" }));
    expect(chain.map((s) => s.kind)).toEqual(["source", "action", "artifact", "audit"]);
  });

  it("artifact step is informative even when no artifact produced yet", () => {
    const chain = buildEvidenceChain(task({ artifact_count: 0, status: "running" }));
    const artifactStep = chain.find((s) => s.kind === "artifact")!;
    expect(artifactStep.detail).toMatch(/nach Abschluss/i);
  });

  it("audit step references auto_heal_log + background_agent_action_dispatched", () => {
    const chain = buildEvidenceChain(task({}));
    const auditStep = chain.find((s) => s.kind === "audit")!;
    expect(auditStep.detail).toMatch(/auto_heal_log/);
    expect(auditStep.detail).toMatch(/background_agent_action_dispatched/);
  });
});

describe("P71 — export helpers", () => {
  const t = task({
    capability_summary: "SEO Opportunity Brief",
    meta: { keywords: ["a", "b"], priority: "high" },
    source_id: "abc-123",
  });

  it("exports valid JSON with type + source identifiers", () => {
    const p = buildArtifactPreview(t);
    const json = exportArtifactAsJson(p, t);
    const parsed = JSON.parse(json);
    expect(parsed.artifact_type).toBe("seo_brief");
    expect(parsed.source_id).toBe("abc-123");
    expect(Array.isArray(parsed.sections)).toBe(true);
  });

  it("exports markdown with title + sections", () => {
    const p = buildArtifactPreview(t);
    const md = exportArtifactAsMarkdown(p, t);
    expect(md).toMatch(/^# SEO Opportunity Brief/m);
    expect(md).toMatch(/## keywords/m);
    expect(md).toMatch(/^- a$/m);
  });
});

describe("P71 — purity & invariants (static)", () => {
  const resolverSrc = readFileSync(RESOLVER_PATH, "utf-8");
  const drawerSrc = readFileSync(DRAWER_PATH, "utf-8");
  const cockpitSrc = readFileSync(COCKPIT_PATH, "utf-8");

  it("resolver is pure — no supabase / network / fs imports", () => {
    expect(resolverSrc).not.toMatch(/supabase\.(from|rpc)/);
    expect(resolverSrc).not.toMatch(/from\s+["']@\/integrations\/supabase/);
    expect(resolverSrc).not.toMatch(/fetch\(/);
  });

  it("resolver is deterministic — no Date.now / Math.random", () => {
    expect(resolverSrc).not.toMatch(/Date\.now\(/);
    expect(resolverSrc).not.toMatch(/Math\.random\(/);
  });

  it("Drawer reads NO source tables and creates NO RPCs of its own", () => {
    expect(drawerSrc).not.toMatch(/supabase\.from\(/);
    expect(drawerSrc).not.toMatch(/supabase\.rpc\(/);
  });

  it("Cockpit wires Drawer for open_artifacts (no external nav for artifacts)", () => {
    expect(cockpitSrc).toMatch(/ArtifactPreviewDrawer/);
    expect(cockpitSrc).toMatch(/setPreviewTask/);
  });

  it("no new migrations are introduced under P71 tag", () => {
    // P71 is a UI/resolver-only cut — explicit guard against accidental table creation.
    const migDir = resolve(ROOT, "../supabase/migrations");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const offenders = readdirSync(migDir).filter((f) => {
      if (!f.endsWith(".sql")) return false;
      const sql = readFileSync(resolve(migDir, f), "utf-8");
      return /P71\b/.test(sql) && /CREATE\s+TABLE/i.test(sql);
    });
    expect(offenders).toEqual([]);
  });
});
