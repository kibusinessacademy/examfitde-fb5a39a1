/**
 * Cut 9 — Source-Guards: Learner-Komponenten dürfen keine DB/AI-Module
 * importieren, dürfen Draft/Review-Begriffe nicht anzeigen, Admin-Panel
 * darf keine Mutationen enthalten.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(p: string) {
  return readFileSync(resolve(process.cwd(), p), "utf-8");
}

const LEARNER = "src/components/learning/OralVisualFeedback.tsx";
const ADMIN = "src/components/admin/visual-learning/OralVisualFeedbackPanel.tsx";

describe("Cut 9 — source-level guards", () => {
  it("Learner-Komponente importiert keinen Supabase-Client", () => {
    const src = read(LEARNER);
    expect(src).not.toMatch(/integrations\/supabase/);
    expect(src).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
  });

  it("Learner-Komponente importiert keine Factory/Review/AI-Draft-Module", () => {
    const src = read(LEARNER);
    expect(src).not.toMatch(/visual-artifact-factory/);
    expect(src).not.toMatch(/visual-artifact-review/);
    expect(src).not.toMatch(/ai-draft-/);
    expect(src).not.toMatch(/persistence(?:-policy)?["']/);
  });

  it("Learner-Komponente enthält keine fetch-/Service-Key-Muster", () => {
    const src = read(LEARNER);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/SERVICE_ROLE/i);
  });

  it("Learner-Komponente enthält keine Draft/Review/Admin-Texte", () => {
    const low = read(LEARNER).toLowerCase();
    expect(low).not.toContain("draft");
    expect(low).not.toContain("review");
    expect(low).not.toContain("debug");
    expect(low).not.toContain("admin");
  });

  it("Learner-Komponente enthält keine Note/Bestanden/Prüfungsreife-Texte", () => {
    const low = read(LEARNER).toLowerCase();
    expect(low).not.toContain("bestanden");
    expect(low).not.toContain("prüfungsreife");
    expect(low).not.toContain("pruefungsreife");
    // "note" als Wort darf nicht in Lernkopie auftauchen (Hinweistexte sind erlaubt)
    expect(low).not.toMatch(/\bnote\b/);
  });

  it("Admin-Panel enthält keine Mutationen / Fetches / AI-Aufrufe", () => {
    const src = read(ADMIN);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/integrations\/supabase/);
    expect(src).not.toMatch(/ai-draft-/);
    expect(src).not.toMatch(/buildOralVisualFeedback\s*\(/);
  });

  it("Admin-Panel verweist auf Strukturfeedback, nicht finale Bewertung", () => {
    const low = read(ADMIN).toLowerCase();
    expect(low).toContain("strukturfeedback");
  });
});
