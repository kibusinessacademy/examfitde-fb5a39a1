/**
 * Governance Architecture Rules — SSOT integrity.
 */
import { describe, it, expect } from "vitest";
import { ARCHITECTURE_RULES } from "@/lib/governance/architecture-rules";

describe("Architectural Continuity Guard · Rule SSOT", () => {
  it("enthält die 10 Kernregeln", () => {
    expect(ARCHITECTURE_RULES.length).toBeGreaterThanOrEqual(10);
  });
  it("alle Regeln haben id, title, principle", () => {
    for (const r of ARCHITECTURE_RULES) {
      expect(r.id).toBeTruthy();
      expect((r as { title?: string }).title ?? (r as { name?: string }).name).toBeTruthy();
    }
  });
  it("IDs sind eindeutig", () => {
    const ids = ARCHITECTURE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("kritische SSOT-Regeln existieren", () => {
    const ids = new Set(ARCHITECTURE_RULES.map((r) => r.id));
    for (const must of ["SSOT_FIRST", "NO_AUTONOMOUS_PRODUCTION_WRITES", "AUDITABLE_MUTATIONS", "GOVERNANCE_BEFORE_AUTOMATION"]) {
      expect(ids.has(must), `Pflichtregel ${must} fehlt`).toBe(true);
    }
  });
});
