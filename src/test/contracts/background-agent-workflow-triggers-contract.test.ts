/**
 * P70.4 — Triggered Background Work: Contract Tests
 *
 * Invariants:
 *  1. Trigger visibility is admin-gated (non-admin → visible=false, enabled=false).
 *  2. Capability kill-switch hard-disables but keeps visibility.
 *  3. Dispatch payload uses the P70.2 single choke point with source_type='workflow' + action='trigger'.
 *  4. SQL dispatcher accepts only 3 whitelisted workflow types + routes them to existing RPCs.
 *  5. Audit-contract reuse: every workflow dispatch writes background_agent_action_dispatched.
 *  6. No new tables / queues / runtimes (P70 migration tag is review-only).
 *  7. Customer-safe wording: no "Curriculum Repair" in any registry label.
 *  8. Cockpit renders Start-Buttons + uses dispatchWorkflowTrigger.
 *  9. Resolver is pure (no supabase from/rpc inside resolveWorkflowTrigger).
 * 10. Dispatch wrapper calls exactly admin_background_agent_dispatch_action.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  WORKFLOW_TRIGGER_REGISTRY,
  resolveWorkflowTrigger,
  dispatchWorkflowTrigger,
  type WorkflowTriggerType,
} from "@/lib/governance/backgroundAgentWorkflowTriggers";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "../supabase/migrations");
const COCKPIT = resolve(ROOT, "pages/admin/governance/BackgroundAgentRuntimePage.tsx");
const RESOLVER = resolve(ROOT, "lib/governance/backgroundAgentWorkflowTriggers.ts");

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: { ok: true, route: "test" }, error: null }),
  },
}));

function loadP70_4Sql(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
  let combined = "";
  for (const f of files) {
    const sql = readFileSync(resolve(MIG_DIR, f), "utf-8");
    if (
      sql.includes("admin_background_agent_dispatch_action") &&
      sql.includes("'workflow'")
    ) {
      combined += "\n-- FILE: " + f + "\n" + sql;
    }
  }
  if (!combined) throw new Error("P70.4 dispatcher migration not found");
  return combined;
}

const SQL = loadP70_4Sql();
const PAGE = readFileSync(COCKPIT, "utf-8");
const RESOLVER_SRC = readFileSync(RESOLVER, "utf-8");

const TYPES: WorkflowTriggerType[] = [
  "seo_opportunity",
  "compliance_drift",
  "operational_quality",
];

describe("P70.4 — Workflow trigger contract", () => {
  it("registry covers exactly the three trigger types", () => {
    expect(Object.keys(WORKFLOW_TRIGGER_REGISTRY).sort()).toEqual([...TYPES].sort());
    for (const t of TYPES) {
      const d = WORKFLOW_TRIGGER_REGISTRY[t];
      expect(d.startLabel.length).toBeGreaterThan(5);
      expect(d.confirmDescription.length).toBeGreaterThan(20);
      expect(d.capabilityKey).toMatch(/^workflow\./);
    }
  });

  it("customer-safe wording — no 'Curriculum Repair' or 'Council' in any visible label", () => {
    for (const d of Object.values(WORKFLOW_TRIGGER_REGISTRY)) {
      const blob = `${d.startLabel} ${d.confirmDescription}`.toLowerCase();
      expect(blob).not.toMatch(/curriculum\s*repair/);
      expect(blob).not.toMatch(/\bcouncil\b/);
    }
  });

  it("resolver: non-admin hides + disables the trigger", () => {
    for (const t of TYPES) {
      const r = resolveWorkflowTrigger(t, { isAdmin: false });
      expect(r.visible).toBe(false);
      expect(r.enabled).toBe(false);
      expect(r.reason).toMatch(/Admin/);
    }
  });

  it("resolver: admin → enabled by default", () => {
    for (const t of TYPES) {
      const r = resolveWorkflowTrigger(t, { isAdmin: true });
      expect(r.visible).toBe(true);
      expect(r.enabled).toBe(true);
    }
  });

  it("resolver: capability kill-switch disables but keeps visibility", () => {
    const t: WorkflowTriggerType = "operational_quality";
    const key = WORKFLOW_TRIGGER_REGISTRY[t].capabilityKey;
    const r = resolveWorkflowTrigger(t, {
      isAdmin: true,
      capabilities: [{ key, is_enabled: false }],
    });
    expect(r.visible).toBe(true);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/Kill-Switch|deaktiviert/);
  });

  it("resolver: capabilities that don't match the key are ignored", () => {
    const r = resolveWorkflowTrigger("seo_opportunity", {
      isAdmin: true,
      capabilities: [{ key: "unrelated.thing", is_enabled: false }],
    });
    expect(r.enabled).toBe(true);
  });

  it("operational_quality is marked dangerous (strong confirm)", () => {
    const r = resolveWorkflowTrigger("operational_quality", { isAdmin: true });
    expect(r.dangerous).toBe(true);
  });

  it("dispatch wrapper calls admin_background_agent_dispatch_action with workflow+trigger", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const rpc = (supabase.rpc as unknown) as ReturnType<typeof vi.fn>;
    rpc.mockClear();
    await dispatchWorkflowTrigger("compliance_drift", "manual");
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, payload] = rpc.mock.calls[0];
    expect(name).toBe("admin_background_agent_dispatch_action");
    expect(payload).toMatchObject({
      p_source_type: "workflow",
      p_source_id: "compliance_drift",
      p_action: "trigger",
    });
    expect(payload.p_reason).toBe("manual");
  });

  it("resolver source is pure — no supabase.from or supabase.rpc references", () => {
    expect(RESOLVER_SRC).not.toMatch(/supabase\.from\(/);
    // resolver lives in the same file as the dispatch wrapper which DOES use rpc.
    // assert the resolver function itself contains no rpc call by scanning its body
    const match = RESOLVER_SRC.match(/export function resolveWorkflowTrigger[\s\S]*?\n\}/);
    expect(match, "resolveWorkflowTrigger body not found").toBeTruthy();
    expect(match![0]).not.toMatch(/supabase\.rpc/);
    expect(match![0]).not.toMatch(/supabase\.from/);
  });

  // --- SQL contract ---

  it("SQL: dispatcher whitelists exactly the 3 workflow types", () => {
    expect(SQL).toMatch(/p_source_id NOT IN \(\s*'seo_opportunity'\s*,\s*'compliance_drift'\s*,\s*'operational_quality'\s*\)/);
  });

  it("SQL: action 'trigger' added to allowlist + bound to source_type='workflow'", () => {
    expect(SQL).toMatch(/p_action NOT IN \([^)]*'trigger'[^)]*\)/);
    expect(SQL).toMatch(/workflow source supports only action=trigger/);
  });

  it("SQL: workflow source routes to existing RPCs only (no new function)", () => {
    expect(SQL).toMatch(/public\.fn_detect_seo_discovery_drift\(\)/);
    expect(SQL).toMatch(/public\.run_azav_compliance_check\(\)/);
    expect(SQL).toMatch(/public\.admin_repair_quality_council_drift\(false,\s*50\)/);
    // No CREATE TABLE / new queue / new runtime introduced in this migration
    expect(SQL).not.toMatch(/CREATE\s+TABLE\s+public\./i);
    expect(SQL).not.toMatch(/CREATE\s+TYPE\s+public\.\w*(queue|planner|runtime|fsm)/i);
  });

  it("SQL: admin gate + audit on both denied and ok paths (reuses background_agent_action_dispatched)", () => {
    expect(SQL).toMatch(/has_role\(v_caller,\s*'admin'::public\.app_role\)/);
    const audits = SQL.match(/background_agent_action_dispatched/g) ?? [];
    // contract registration may or may not appear in this migration; dispatcher must
    // emit at least denied + ok branches
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(SQL).toMatch(/'outcome','forbidden_not_admin'/);
    expect(SQL).toMatch(/'outcome','dispatched'/);
  });

  // --- Cockpit contract ---

  it("Cockpit imports + uses workflow-trigger registry and dispatch wrapper", () => {
    expect(PAGE).toMatch(/WORKFLOW_TRIGGER_REGISTRY/);
    expect(PAGE).toMatch(/resolveWorkflowTrigger/);
    expect(PAGE).toMatch(/dispatchWorkflowTrigger/);
  });

  it("Cockpit renders Start-Button for each workflow type (data-workflow-trigger=...)", () => {
    for (const t of TYPES) {
      expect(
        PAGE.includes(`data-workflow-trigger={type}`) && PAGE.includes(`'${t}'`),
        `cockpit missing trigger wiring for ${t}`,
      ).toBe(true);
    }
  });

  it("Cockpit shows confirm dialog before performing trigger (no autofire)", () => {
    expect(PAGE).toMatch(/setPendingTrigger\(trigger\)/);
    expect(PAGE).toMatch(/performTrigger\(\)/);
    expect(PAGE).toMatch(/Workflow starten/);
  });
});
