/**
 * P72 — Scheduled Agent Runs · Contract Tests
 *
 * Statische CI-Garantien (Akzeptanzkriterien):
 *  - Schedule-Mapping cron.job → 3 Workflows
 *  - Empty-State wenn keine Cron-Zeile vorhanden
 *  - Disabled enable/disable mit erklärendem Reason
 *  - run_now nutzt bestehenden P70.2-Chokepoint
 *  - Keine direkten Table-Reads im Resolver/UI
 *  - Keine neuen Tabellen in P72-Migrationen
 *  - Customer-Labels enthalten keine internen Begriffe
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildScheduleCards,
  canToggleSchedule,
  type ScheduleRowLike,
} from "@/lib/governance/backgroundAgentSchedules";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "../supabase/migrations");
const RESOLVER = resolve(ROOT, "lib/governance/backgroundAgentSchedules.ts");
const COCKPIT = resolve(ROOT, "pages/admin/governance/BackgroundAgentRuntimePage.tsx");

function readResolver() {
  return readFileSync(RESOLVER, "utf-8");
}
function readCockpit() {
  return readFileSync(COCKPIT, "utf-8");
}

function row(over: Partial<ScheduleRowLike>): ScheduleRowLike {
  return {
    workflow_type: "seo_opportunity",
    jobid: 1,
    jobname: "seo-cron",
    schedule: "*/5 * * * *",
    active: true,
    last_run_at: null,
    last_status: null,
    intent_count_24h: 0,
    ...over,
  };
}

describe("P72 — Schedule Mapping", () => {
  it("returns one card per supported workflow type", () => {
    const cards = buildScheduleCards([]);
    expect(cards.map((c) => c.type)).toEqual([
      "seo_opportunity",
      "compliance_drift",
      "operational_quality",
    ]);
  });

  it("groups cron rows by workflow_type", () => {
    const cards = buildScheduleCards([
      row({ workflow_type: "seo_opportunity", jobname: "seo-a" }),
      row({ workflow_type: "seo_opportunity", jobname: "seo-b" }),
      row({ workflow_type: "compliance_drift", jobname: "azav" }),
    ]);
    const seo = cards.find((c) => c.type === "seo_opportunity")!;
    const comp = cards.find((c) => c.type === "compliance_drift")!;
    expect(seo.scheduleCount).toBe(2);
    expect(comp.scheduleCount).toBe(1);
  });

  it("ignores unknown workflow_type values", () => {
    const cards = buildScheduleCards([
      row({ workflow_type: "unknown_thing", jobname: "x" }),
    ]);
    expect(cards.every((c) => c.scheduleCount === 0)).toBe(true);
  });
});

describe("P72 — Active / Last-Run aggregation", () => {
  it("active=true if any cron row is active", () => {
    const cards = buildScheduleCards([
      row({ active: false, jobname: "a" }),
      row({ active: true, jobname: "b" }),
    ]);
    expect(cards.find((c) => c.type === "seo_opportunity")!.active).toBe(true);
  });

  it("picks most recent last_run_at across rows", () => {
    const cards = buildScheduleCards([
      row({ last_run_at: "2026-05-20T10:00:00Z", last_status: "succeeded", jobname: "a" }),
      row({ last_run_at: "2026-05-25T12:00:00Z", last_status: "failed", jobname: "b" }),
    ]);
    const seo = cards.find((c) => c.type === "seo_opportunity")!;
    expect(seo.lastRunAt).toBe("2026-05-25T12:00:00Z");
    expect(seo.lastStatus).toBe("failed");
  });

  it("riskLevel=high if any last_status=failed", () => {
    const cards = buildScheduleCards([
      row({ last_status: "failed" }),
    ]);
    expect(cards.find((c) => c.type === "seo_opportunity")!.riskLevel).toBe("high");
  });

  it("aggregates intent_count_24h", () => {
    const cards = buildScheduleCards([
      row({ intent_count_24h: 5 }),
      row({ intent_count_24h: "7" }),
    ]);
    expect(cards.find((c) => c.type === "seo_opportunity")!.intentCount24h).toBe(12);
  });
});

describe("P72 — Empty State", () => {
  it("when no cron row exists, scheduleCount=0 + lastRunAt=null + active=false", () => {
    const cards = buildScheduleCards([]);
    for (const c of cards) {
      expect(c.scheduleCount).toBe(0);
      expect(c.lastRunAt).toBeNull();
      expect(c.active).toBe(false);
    }
  });

  it("evidence-chain communicates empty-state in customer-safe wording", () => {
    const [card] = buildScheduleCards([]);
    const detail = card.evidenceChain.map((s) => s.detail).join(" | ");
    expect(detail).toMatch(/Kein automatischer Lauf geplant/);
    expect(detail).not.toMatch(/curriculum repair/i);
    expect(detail).not.toMatch(/\bcouncil\b/i);
  });
});

describe("P72 — Enable / Disable contract", () => {
  it("canToggleSchedule returns disabled with explanatory reason", () => {
    const r = canToggleSchedule();
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/Dispatcher|Cron-Mutation/);
  });
});

describe("P72 — Evidence Chain", () => {
  it("always has exactly 5 ordered steps (schedule→trigger→task→artifact→audit)", () => {
    const [card] = buildScheduleCards([row({})]);
    expect(card.evidenceChain.map((s) => s.kind)).toEqual([
      "schedule",
      "trigger",
      "task",
      "artifact",
      "audit",
    ]);
  });
});

describe("P72 — Customer-Safe Labels", () => {
  it("never exposes internal terminology in card labels/descriptions", () => {
    const cards = buildScheduleCards([row({})]);
    for (const c of cards) {
      const blob = `${c.label} ${c.description}`.toLowerCase();
      expect(blob).not.toContain("curriculum repair");
      expect(blob).not.toContain("council");
    }
    const op = cards.find((c) => c.type === "operational_quality")!;
    expect(op.label).toMatch(/Qualitätsoptimierung/);
  });
});

describe("P72 — Purity / No-Mutation guards", () => {
  it("resolver contains no supabase.from / supabase.rpc / fetch / Date.now / Math.random", () => {
    const src = readResolver();
    expect(src).not.toMatch(/supabase\.from\(/);
    expect(src).not.toMatch(/supabase\.rpc\(/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/Math\.random\(/);
  });
});

describe("P72 — Cockpit wiring", () => {
  it("Scheduled Runs tab reads ONLY via admin_get_background_agent_schedules", () => {
    const page = readCockpit();
    expect(page).toMatch(/admin_get_background_agent_schedules/);
    // No direct cron.job reads from client
    expect(page).not.toMatch(/from\(\s*['"]cron\./);
    expect(page).not.toMatch(/supabase\.from\(\s*['"]system_intents['"]/);
  });

  it("run_now in cockpit dispatches via existing P70.2 chokepoint (dispatchWorkflowTrigger)", () => {
    const page = readCockpit();
    expect(page).toMatch(/dispatchWorkflowTrigger|admin_background_agent_dispatch_action/);
  });

  it("Cockpit imports ArtifactPreviewDrawer for latest-artifact preview", () => {
    const page = readCockpit();
    expect(page).toMatch(/ArtifactPreviewDrawer/);
  });
});

describe("P72 — Migration discipline", () => {
  it("P72-tagged migrations do NOT create new tables / queues / cron primitives", () => {
    const files = readdirSync(MIG_DIR).filter((f) => /p72|scheduled_agent_runs/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const sql = readFileSync(resolve(MIG_DIR, f), "utf-8");
      expect(sql, `${f}: CREATE TABLE forbidden`).not.toMatch(/create\s+table\s+public\./i);
      expect(sql, `${f}: cron.schedule mutation forbidden`).not.toMatch(/cron\.schedule\(/i);
      expect(sql, `${f}: cron.unschedule mutation forbidden`).not.toMatch(/cron\.unschedule\(/i);
      expect(sql, `${f}: must be admin-gated`).toMatch(/has_role\(.*'admin'/);
    }
  });
});
