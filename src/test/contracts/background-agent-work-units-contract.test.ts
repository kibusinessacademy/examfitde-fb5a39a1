/**
 * P70.3 — First Visible Background Workflows: Contract Tests
 *
 * Invariants:
 *  - Resolver/normalizer is a pure layer on top of P70.1 view rows.
 *  - Three customer/stakeholder outcomes exist with product-facing labels.
 *  - Internal "Curriculum Repair" wording never reaches customer copy.
 *  - No new tables / no new runtime / no new dispatcher introduced.
 *  - source_type+source_id of every grouped task remains traceable.
 *  - Cockpit consumes the resolver and surfaces outcome labels.
 *  - Action gating from P70.2 is unchanged (re-used as-is).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyWorkUnit,
  describeWorkUnit,
  groupTasksByWorkUnit,
  WORK_UNIT_REGISTRY,
  type WorkUnitType,
} from "@/lib/governance/backgroundAgentWorkUnits";
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";

const ROOT = resolve(__dirname, "../..");
const RESOLVER = resolve(ROOT, "lib/governance/backgroundAgentWorkUnits.ts");
const COCKPIT = resolve(ROOT, "pages/admin/governance/BackgroundAgentRuntimePage.tsx");
const MIG_DIR = resolve(ROOT, "../supabase/migrations");

const RESOLVER_SRC = readFileSync(RESOLVER, "utf-8");
const PAGE = readFileSync(COCKPIT, "utf-8");

function task(p: Partial<BackgroundTaskLike> & { task_kind?: string | null; meta?: unknown }): BackgroundTaskLike {
  return {
    source_type: "job_queue",
    source_id: "sid-" + Math.random().toString(36).slice(2, 8),
    status: "pending",
    risk_level: "low",
    approval_state: "not_required",
    artifact_count: 0,
    package_id: null,
    capability_summary: "demo",
    ...p,
  } as BackgroundTaskLike;
}

describe("P70.3 — Work-unit registry & customer-facing copy", () => {
  it("exposes exactly three customer/stakeholder-visible outcomes", () => {
    const keys = Object.keys(WORK_UNIT_REGISTRY).sort();
    expect(keys).toEqual(["compliance_drift", "operational_quality", "seo_opportunity"]);
  });

  it("each descriptor has outcomeLabel, description, externalLabel, visibility", () => {
    for (const d of Object.values(WORK_UNIT_REGISTRY)) {
      expect(d.outcomeLabel.length).toBeGreaterThan(3);
      expect(d.description.length).toBeGreaterThan(10);
      expect(d.externalLabel.length).toBeGreaterThan(3);
      expect(["customer_visible", "internal_only_quality"]).toContain(d.visibility);
    }
  });

  it("never surfaces the internal 'Curriculum Repair' label externally", () => {
    for (const d of Object.values(WORK_UNIT_REGISTRY)) {
      expect(d.externalLabel.toLowerCase()).not.toContain("curriculum");
      expect(d.externalLabel.toLowerCase()).not.toContain("repair");
      expect(d.outcomeLabel.toLowerCase()).not.toContain("curriculum repair");
    }
  });

  it("operational_quality is gated as internal_only_quality with safe external synonym", () => {
    const d = WORK_UNIT_REGISTRY.operational_quality;
    expect(d.visibility).toBe("internal_only_quality");
    expect(d.externalLabel).toMatch(/Qualität|Optimierung/i);
  });
});

describe("P70.3 — classifier: label mapping & source grouping", () => {
  const cases: Array<[Partial<BackgroundTaskLike> & { task_kind?: string }, WorkUnitType]> = [
    [{ capability_summary: "seo_intent_page_generate · seo" }, "seo_opportunity"],
    [{ capability_summary: "internal_link_optimize · seo" }, "seo_opportunity"],
    [{ capability_summary: "cert_pillar_refresh · seo" }, "seo_opportunity"],
    [{ source_type: "system_intents", capability_summary: "seo_cluster_refresh" }, "seo_opportunity"],
    [{ capability_summary: "compliance_evidence_export · governance" }, "compliance_drift"],
    [{ capability_summary: "provider_drift_check · trust" }, "compliance_drift"],
    [{ capability_summary: "dsgvo_data_export · governance" }, "compliance_drift"],
    [{ capability_summary: "package_quality_council · control" }, "operational_quality"],
    [{ capability_summary: "package_run_integrity_check · control" }, "operational_quality"],
    [{ capability_summary: "exam_pool_refill_bloom · build" }, "operational_quality"],
    [{ source_type: "heal_permanent_fix_tasks", capability_summary: "anything" }, "operational_quality"],
    [{ capability_summary: "random_unrelated_thing · misc" }, "other"],
  ];
  it.each(cases)("classifies %j → %s", (input, expected) => {
    expect(classifyWorkUnit(task(input))).toBe(expected);
  });

  it("groupTasksByWorkUnit preserves source_type + source_id (traceability)", () => {
    const t = task({ source_id: "trace-1", capability_summary: "seo_intent_page_generate" });
    const groups = groupTasksByWorkUnit([t]);
    expect(groups[0].sample[0].source_type).toBe("job_queue");
    expect(groups[0].sample[0].source_id).toBe("trace-1");
  });

  it("groupTasksByWorkUnit drops 'other' from the visible workflow tab", () => {
    const groups = groupTasksByWorkUnit([
      task({ capability_summary: "random_unrelated_thing" }),
      task({ capability_summary: "seo_brief_generate" }),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["seo_opportunity"]);
  });

  it("aggregates status/approval/risk/artifacts per group", () => {
    const seoFailed = task({ capability_summary: "seo_a", status: "failed", risk_level: "high" });
    const seoPending = task({ capability_summary: "seo_b", status: "pending", artifact_count: 2 });
    const seoApproval = task({
      capability_summary: "seo_c",
      status: "running",
      approval_state: "pending",
    });
    const groups = groupTasksByWorkUnit([seoFailed, seoPending, seoApproval]);
    const g = groups.find((x) => x.type === "seo_opportunity")!;
    expect(g.total).toBe(3);
    expect(g.failed).toBe(1);
    expect(g.pending).toBe(1);
    expect(g.running).toBe(1);
    expect(g.awaitingApproval).toBe(1);
    expect(g.highRisk).toBe(1);
    expect(g.artifactCount).toBe(2);
  });

  it("describeWorkUnit returns null for 'other'", () => {
    expect(describeWorkUnit("other")).toBeNull();
    expect(describeWorkUnit("seo_opportunity")).not.toBeNull();
  });
});

describe("P70.3 — Invariants: no new orchestration truth, cockpit binding", () => {
  it("resolver introduces NO supabase.from / supabase.rpc calls (pure layer)", () => {
    expect(RESOLVER_SRC).not.toMatch(/supabase\.from\(/);
    expect(RESOLVER_SRC).not.toMatch(/supabase\.rpc\(/);
  });

  it("no new tables/queues/views introduced by P70.3 migrations", () => {
    const sqlFiles = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
    for (const f of sqlFiles) {
      const sql = readFileSync(resolve(MIG_DIR, f), "utf-8");
      // Any P70.3-tagged migration must NOT create new tables/queues.
      if (sql.includes("P70.3") || sql.includes("work_unit") || sql.includes("background_workflow")) {
        expect(sql, `${f} must not CREATE TABLE`).not.toMatch(/CREATE\s+TABLE\s+public\./i);
        expect(sql, `${f} must not CREATE new QUEUE/SCHEDULER`).not.toMatch(
          /CREATE\s+TABLE\s+public\.\w*(queue|scheduler|planner)/i,
        );
      }
    }
  });

  it("cockpit renders the Workflows tab via the work-unit registry", () => {
    expect(PAGE).toMatch(/groupTasksByWorkUnit/);
    // Cockpit must render the descriptor outcome label (not hardcoded strings).
    expect(PAGE).toMatch(/descriptor\.outcomeLabel/);
    // Internal-only marker must be respected in UI.
    expect(PAGE).toMatch(/internal_only_quality/);
  });


  it("cockpit re-uses the P70.2 action chokepoint (no parallel dispatcher)", () => {
    expect(PAGE).toMatch(/dispatchBackgroundAgentAction/);
    expect(PAGE).toMatch(/resolveBackgroundAgentActions/);
  });
});
