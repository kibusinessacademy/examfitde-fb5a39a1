/**
 * P70.1 — Background Agent Runtime: Unification-Bridge Contract Tests
 *
 * Statische Garantien (CI-Gate) gegen Drift der Akzeptanzkriterien:
 *  1. v_background_agent_runtime liefert die kanonische Spaltenform
 *  2. Admin-RPCs sind has_role-gated
 *  3. Cockpit liest NUR über RPCs (keine Direct-Table-Reads)
 *  4. Keine neuen Background-Tabellen / kein neuer Planner
 *  5. system_intents werden gegen job_queue.correlation_id dedupliziert
 *  6. Status-Mapping konsistent (CASE-Branches in der View)
 *  7. Cockpit rendert Empty-State + alle Pflichtfelder
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "../supabase/migrations");
const COCKPIT = resolve(ROOT, "pages/admin/governance/BackgroundAgentRuntimePage.tsx");

function findP70Migration(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
  let latest = "";
  for (const f of files) {
    const sql = readFileSync(resolve(MIG_DIR, f), "utf-8");
    if (sql.includes("v_background_agent_runtime") && sql.includes("admin_get_background_agent_tasks")) {
      if (f > latest) latest = f;
    }
  }
  if (!latest) throw new Error("P70.1 migration not found");
  return readFileSync(resolve(MIG_DIR, latest), "utf-8");
}

const SQL = findP70Migration();
const PAGE = readFileSync(COCKPIT, "utf-8");

const REQUIRED_VIEW_COLUMNS = [
  "source_type",
  "source_id",
  "status",
  "risk_level",
  "capability_summary",
  "approval_state",
  "cost_eur",
  "budget_eur",
  "artifact_count",
  "last_event_at",
];

const ALLOWED_SOURCES = [
  "job_queue",
  "system_intents",
  "berufs_ki_agent_runs",
  "runtime_action_results",
  "heal_permanent_fix_tasks",
];

describe("P70.1 — Background Agent Runtime contract", () => {
  it("View liefert alle kanonischen Pflicht-Spalten (Akzeptanz #4)", () => {
    for (const col of REQUIRED_VIEW_COLUMNS) {
      expect(SQL, `view fehlt Spalte ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("View aggregiert NUR die 5 erlaubten bestehenden Quellen (Akzeptanz #1, #6)", () => {
    for (const src of ALLOWED_SOURCES) {
      expect(SQL).toMatch(new RegExp(`'${src}'::text`));
    }
    // Keine Erfindung neuer Background-Tabellen
    expect(SQL).not.toMatch(/CREATE\s+TABLE\s+public\.(background_tasks|agent_tasks|agent_runtime)/i);
  });

  it("View ist read-only auf service_role (Akzeptanz #1)", () => {
    expect(SQL).toMatch(/REVOKE ALL ON public\.v_background_agent_runtime FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT\s+SELECT ON public\.v_background_agent_runtime TO service_role/);
  });

  it("Admin-RPCs sind has_role(admin)-gated (Akzeptanz #2)", () => {
    const rpcs = [
      "admin_get_background_agent_runtime_summary",
      "admin_get_background_agent_tasks",
      "admin_get_background_agent_capabilities",
    ];
    for (const rpc of rpcs) {
      expect(SQL, `${rpc} fehlt`).toMatch(new RegExp(`FUNCTION public\\.${rpc}`));
    }
    // Zähle WHERE has_role(...,'admin')-Klauseln innerhalb der RPC-Bodies
    const adminGuards = SQL.match(/has_role\(auth\.uid\(\),\s*'admin'\)/g) ?? [];
    expect(adminGuards.length).toBeGreaterThanOrEqual(3);
  });

  it("system_intents werden gegen job_queue.correlation_id dedupliziert (Akzeptanz #7)", () => {
    expect(SQL).toMatch(/jq\.correlation_id\s*=\s*s\.id/);
    expect(SQL).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM public\.job_queue jq/);
  });

  it("Status-Mapping normalisiert auf kanonische Werte (Akzeptanz #7)", () => {
    const canonical = ["'pending'", "'running'", "'completed'", "'failed'", "'rejected'", "'awaiting_approval'"];
    for (const s of canonical) {
      expect(SQL, `Status ${s} fehlt im Mapping`).toMatch(new RegExp(s.replace(/'/g, "")));
    }
  });

  it("Keine neue Queue / kein paralleler Planner (Akzeptanz #6)", () => {
    expect(SQL).not.toMatch(/CREATE\s+TABLE\s+public\.\w*(queue|planner|scheduler|fsm)\w*/i);
    expect(SQL).not.toMatch(/CREATE\s+TYPE\s+public\.\w*planner\w*/i);
  });

  it("Cockpit liest NUR via Admin-RPCs (keine Direct-Table-Reads, Akzeptanz #5)", () => {
    expect(PAGE).toMatch(/supabase\.rpc\(['"]admin_get_background_agent_runtime_summary['"]/);
    expect(PAGE).toMatch(/supabase\.rpc\(['"]admin_get_background_agent_tasks['"]/);
    expect(PAGE).toMatch(/supabase\.rpc\(['"]admin_get_background_agent_capabilities['"]/);

    // Kein supabase.from('<eine der 5 Quellen>') im Client
    for (const src of ALLOWED_SOURCES) {
      const pattern = new RegExp(`supabase\\.from\\(\\s*['"]${src}['"]`);
      expect(PAGE, `Direct-Read auf ${src} verboten`).not.toMatch(pattern);
    }
    expect(PAGE).not.toMatch(/supabase\.from\(\s*['"]v_background_agent_runtime['"]/);
  });

  it("Cockpit rendert Empty-State + kanonische Spalten (Akzeptanz #3, #4)", () => {
    expect(PAGE).toMatch(/Keine Arbeitseinheiten/);
    // Cockpit zeigt Work-Units (Arbeitseinheit/Risiko/Approval), nicht Roh-Job-Begriffe
    expect(PAGE).toMatch(/Arbeitseinheit/);
    expect(PAGE).toMatch(/Risiko/);
    expect(PAGE).toMatch(/Approval/);
    expect(PAGE).toMatch(/Artefakte/);
  });
});
