/**
 * P73 — Background Agent Business Value Layer Contract Tests
 *
 * Statische Garantien:
 *  1. Resolver ist pure (kein supabase/fetch/Date.now/Math.random)
 *  2. Value-Mapping deterministisch (Artifact-Typ → Opportunities/Risiken/Reports/Checks/Minuten)
 *  3. Empty-State (keine Tasks) liefert 3 Cards mit 0-Metriken
 *  4. Health-Verdict: running > failed-only > no_artifacts_yet > stale > healthy
 *  5. Latest-Outcome stabil sortiert
 *  6. Customer-safe Copy enthält keine internen Begriffe
 *     (curriculum repair / council / drift-heal / bronze / phantom etc.)
 *  7. Cockpit liest Value-Layer NUR aus Resolver, nicht aus DB/RPC
 *  8. Keine neuen Migrations/Tabellen unter P73
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildWorkflowValueCards,
  formatMinutesSaved,
  isStale,
  MINUTES_PER_ARTIFACT,
} from "@/lib/governance/backgroundAgentValue";
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";

const SRC = resolve(__dirname, "../..");
const RESOLVER = resolve(SRC, "lib/governance/backgroundAgentValue.ts");
const COCKPIT = resolve(SRC, "pages/admin/governance/BackgroundAgentRuntimePage.tsx");
const MIG_DIR = resolve(SRC, "../supabase/migrations");

const RESOLVER_SRC = readFileSync(RESOLVER, "utf-8");
const COCKPIT_SRC = readFileSync(COCKPIT, "utf-8");

function task(overrides: Partial<BackgroundTaskLike> & { source_id: string }): BackgroundTaskLike {
  return {
    source_type: "job_queue",
    source_id: overrides.source_id,
    status: overrides.status ?? "completed",
    risk_level: overrides.risk_level ?? "low",
    approval_state: overrides.approval_state ?? "not_required",
    artifact_count: overrides.artifact_count ?? 1,
    package_id: overrides.package_id ?? null,
    capability_summary: overrides.capability_summary ?? null,
    ...overrides,
  };
}

const NOW = "2026-05-26T12:00:00.000Z";

describe("P73 — Value Layer purity", () => {
  it("resolver verwendet weder DB-Client, fetch noch Random/Date.now", () => {
    expect(RESOLVER_SRC).not.toMatch(/from\s+['"]@\/integrations\/supabase\/client['"]/);
    expect(RESOLVER_SRC).not.toMatch(/supabase\.(from|rpc|channel|storage|auth)\b/);
    expect(RESOLVER_SRC).not.toMatch(/\bfetch\s*\(/);
    expect(RESOLVER_SRC).not.toMatch(/Math\.random/);
    expect(RESOLVER_SRC).not.toMatch(/Date\.now/);
    expect(RESOLVER_SRC).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });

  it("MINUTES_PER_ARTIFACT deckt alle Artifact-Typen ab und ist nicht-negativ", () => {
    for (const v of Object.values(MINUTES_PER_ARTIFACT)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(MINUTES_PER_ARTIFACT.seo_brief).toBeGreaterThan(0);
    expect(MINUTES_PER_ARTIFACT.compliance_evidence).toBeGreaterThan(MINUTES_PER_ARTIFACT.seo_brief);
    expect(MINUTES_PER_ARTIFACT.unknown).toBe(0);
  });
});

describe("P73 — Empty-State", () => {
  it("liefert 3 customer-facing Cards mit 0-Metriken und no_artifacts_yet-Health", () => {
    const cards = buildWorkflowValueCards([], { nowIso: NOW });
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.type)).toEqual([
      "seo_opportunity",
      "compliance_drift",
      "operational_quality",
    ]);
    for (const c of cards) {
      expect(c.metrics.opportunitiesFound).toBe(0);
      expect(c.metrics.risksAvoided).toBe(0);
      expect(c.metrics.reportsGenerated).toBe(0);
      expect(c.metrics.estimatedMinutesSaved).toBe(0);
      expect(c.latestOutcome).toBeNull();
      expect(c.health).toBe("no_artifacts_yet");
    }
  });
});

describe("P73 — Value-Mapping", () => {
  it("SEO-Brief liefert Opportunities + Reports + Minuten", () => {
    const t = task({
      source_id: "s1",
      capability_summary: "seo intent page brief generate",
      artifact_count: 2,
    });
    const cards = buildWorkflowValueCards([t], { nowIso: NOW });
    const seo = cards.find((c) => c.type === "seo_opportunity")!;
    expect(seo.metrics.opportunitiesFound).toBe(2);
    expect(seo.metrics.reportsGenerated).toBe(2);
    expect(seo.metrics.estimatedMinutesSaved).toBe(2 * MINUTES_PER_ARTIFACT.seo_brief);
    expect(seo.metrics.risksAvoided).toBe(0);
  });

  it("Compliance Evidence liefert Risks + Reports + Checks", () => {
    const t = task({
      source_id: "c1",
      capability_summary: "ai-act dsgvo compliance evidence",
      artifact_count: 3,
    });
    const cards = buildWorkflowValueCards([t], { nowIso: NOW });
    const cmp = cards.find((c) => c.type === "compliance_drift")!;
    expect(cmp.metrics.risksAvoided).toBe(3);
    expect(cmp.metrics.reportsGenerated).toBe(3);
    expect(cmp.metrics.checksCompleted).toBe(3);
    expect(cmp.metrics.estimatedMinutesSaved).toBe(3 * MINUTES_PER_ARTIFACT.compliance_evidence);
  });

  it("Quality-Plan liefert Reports + Checks unter customer-safer Headline", () => {
    const t = task({
      source_id: "q1",
      capability_summary: "quality integrity pipeline check",
      artifact_count: 1,
    });
    const cards = buildWorkflowValueCards([t], { nowIso: NOW });
    const q = cards.find((c) => c.type === "operational_quality")!;
    expect(q.metrics.reportsGenerated).toBe(1);
    expect(q.metrics.checksCompleted).toBe(1);
    expect(q.headline).toBe("KI erledigt wiederkehrende Prüfungen");
  });

  it("Tasks ohne completed-Status zählen NICHT in Value-Metriken", () => {
    const running = task({ source_id: "r", status: "running", capability_summary: "seo brief", artifact_count: 5 });
    const cards = buildWorkflowValueCards([running], { nowIso: NOW });
    const seo = cards.find((c) => c.type === "seo_opportunity")!;
    expect(seo.metrics.opportunitiesFound).toBe(0);
    expect(seo.health).toBe("running");
    expect(seo.totals.running).toBe(1);
  });
});

describe("P73 — Health-Verdict", () => {
  it("failed-only → failed", () => {
    const t = task({ source_id: "f", status: "failed", capability_summary: "seo brief", artifact_count: 0 });
    const card = buildWorkflowValueCards([t], { nowIso: NOW }).find((c) => c.type === "seo_opportunity")!;
    expect(card.health).toBe("failed");
  });

  it("running dominiert über failed", () => {
    const tasks = [
      task({ source_id: "f", status: "failed", capability_summary: "seo brief", artifact_count: 0 }),
      task({ source_id: "r", status: "running", capability_summary: "seo brief", artifact_count: 0 }),
    ];
    const card = buildWorkflowValueCards(tasks, { nowIso: NOW }).find((c) => c.type === "seo_opportunity")!;
    expect(card.health).toBe("running");
  });

  it("kein artifact aber tasks vorhanden → no_artifacts_yet", () => {
    const t = task({ source_id: "p", status: "pending", capability_summary: "seo brief", artifact_count: 0 });
    const card = buildWorkflowValueCards([t], { nowIso: NOW }).find((c) => c.type === "seo_opportunity")!;
    expect(card.health).toBe("no_artifacts_yet");
  });

  it("alter completed-Lauf > 24h → stale", () => {
    const t = task({
      source_id: "s",
      status: "completed",
      capability_summary: "seo brief",
      artifact_count: 1,
      last_event_at: "2026-05-20T00:00:00.000Z",
    } as never);
    const card = buildWorkflowValueCards([t], { nowIso: NOW }).find((c) => c.type === "seo_opportunity")!;
    expect(card.health).toBe("stale");
  });

  it("isStale ist deterministisch und behandelt null", () => {
    expect(isStale(null, NOW)).toBe(false);
    expect(isStale("2026-05-26T10:00:00.000Z", NOW, 24)).toBe(false);
    expect(isStale("2026-05-24T10:00:00.000Z", NOW, 24)).toBe(true);
  });
});

describe("P73 — Latest Outcome", () => {
  it("wählt den jüngsten completed-Task, deterministisch", () => {
    const a = task({
      source_id: "a", capability_summary: "seo brief",
      last_event_at: "2026-05-26T10:00:00.000Z", artifact_count: 1,
    } as never);
    const b = task({
      source_id: "b", capability_summary: "seo brief",
      last_event_at: "2026-05-26T11:00:00.000Z", artifact_count: 1,
    } as never);
    const card = buildWorkflowValueCards([a, b], { nowIso: NOW }).find((c) => c.type === "seo_opportunity")!;
    expect(card.latestOutcome?.source_id).toBe("b");
    expect(card.latestOutcome?.artifactType).toBe("seo_brief");
  });
});

describe("P73 — Customer-safe Copy", () => {
  it("keine internen Begriffe in headlines/promises/health labels", () => {
    const cards = buildWorkflowValueCards([], { nowIso: NOW });
    const blob = JSON.stringify(cards).toLowerCase();
    for (const banned of [
      "curriculum repair", "council", "drift-heal", "bronze",
      "phantom", "blueprint", "job_queue", "system_intents",
    ]) {
      expect(blob).not.toContain(banned);
    }
  });

  it("formatMinutesSaved menschlich", () => {
    expect(formatMinutesSaved(0)).toBe("—");
    expect(formatMinutesSaved(45)).toBe("45 Min");
    expect(formatMinutesSaved(60)).toBe("1 Std");
    expect(formatMinutesSaved(95)).toBe("1 Std 35 Min");
  });
});

describe("P73 — Cockpit-Integration", () => {
  it("Cockpit importiert + nutzt nur den pure Resolver, keinen neuen RPC", () => {
    expect(COCKPIT_SRC).toMatch(/from\s+['"]@\/lib\/governance\/backgroundAgentValue['"]/);
    expect(COCKPIT_SRC).toMatch(/buildWorkflowValueCards\s*\(/);
    // Keine neuen RPCs für P73
    expect(COCKPIT_SRC).not.toMatch(/admin_get_background_agent_value/);
    expect(COCKPIT_SRC).not.toMatch(/admin_get_workflow_outcome_summary/);
  });

  it("Cockpit zeigt P73 customer copy", () => {
    expect(COCKPIT_SRC).toMatch(/Wirkung/);
  });

  it("keine neuen Migrations unter P73-Tag", () => {
    const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
    for (const f of files) {
      const sql = readFileSync(resolve(MIG_DIR, f), "utf-8");
      expect(sql, `${f} darf kein P73-spezifisches Objekt anlegen`).not.toMatch(
        /background_agent_value|workflow_value_card|fn_compute_background_agent_value/i,
      );
    }
  });
});
