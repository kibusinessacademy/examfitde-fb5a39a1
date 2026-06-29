/**
 * Cut 8 — Source-level guards: components stay free of Supabase / factory /
 * AI-draft / review imports and forbidden service-key patterns.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = [
  "src/components/learning/VisualMasteryHint.tsx",
  "src/components/admin/visual-learning/VisualMasterySignalPanel.tsx",
];

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8");
}

describe("Cut 8 — component source guards", () => {
  it("29. no Supabase imports", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src).not.toMatch(/@\/integrations\/supabase/);
      expect(src).not.toMatch(/from\s+["']@supabase/);
    }
  });

  it("30. no factory/review/ai-draft module imports", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src).not.toMatch(/visual-artifact-factory/);
      expect(src).not.toMatch(/visual-artifact-review/);
      expect(src).not.toMatch(/ai-draft-(pipeline|request|policy)/);
    }
  });

  it("31. learner component shows no draft/review/admin copy", () => {
    const src = read("src/components/learning/VisualMasteryHint.tsx");
    expect(src.toLowerCase()).not.toMatch(/draft/);
    expect(src.toLowerCase()).not.toMatch(/needs_review/);
    expect(src.toLowerCase()).not.toMatch(/admin/);
  });

  it("32. no service-role / fetch / SUPABASE_SERVICE_ROLE patterns", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src).not.toMatch(/SERVICE_ROLE/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
