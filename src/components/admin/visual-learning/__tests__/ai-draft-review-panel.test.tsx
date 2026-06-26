import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";

import VisualAiDraftReviewPanel from "../VisualAiDraftReviewPanel";
import { prepareVisualArtifactDraftFromAi } from "@/lib/visual-learning-os/ai-draft-pipeline";
import {
  ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE,
  ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_HEX_COLOR,
  ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_VALID,
} from "@/lib/visual-learning-os/fixtures";

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(t|j)sx?$/.test(entry)) acc.push(p);
  }
  return acc;
}

describe("VISUAL.LEARNING.OS — Cut 6 AI Draft Review Panel", () => {
  it("26. rendert Blocker und Warnings", () => {
    const draft = prepareVisualArtifactDraftFromAi({
      context: ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE,
      raw_output: ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_HEX_COLOR,
    });
    render(<VisualAiDraftReviewPanel draft={draft} />);
    expect(screen.getByTestId("vlo-ai-draft-blockers")).toBeInTheDocument();
    expect(screen.getByTestId("vlo-ai-draft-warnings")).toBeInTheDocument();
    expect(draft.blockers.length).toBeGreaterThan(0);
  });

  it("27. zeigt Admin-Review-Hinweis", () => {
    const draft = prepareVisualArtifactDraftFromAi({
      context: ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE,
      raw_output: ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_VALID,
    });
    render(<VisualAiDraftReviewPanel draft={draft} />);
    const notice = screen.getByTestId("vlo-ai-draft-admin-notice");
    expect(notice.textContent ?? "").toMatch(/Admin Review erforderlich/i);
    expect(screen.getByTestId("vlo-ai-draft-learner-visible").getAttribute("data-learner-visible")).toBe(
      "false",
    );
    expect(screen.getByTestId("vlo-ai-draft-publishable").getAttribute("data-publishable")).toBe(
      "false",
    );
  });

  it("28. enthält keinen aktiven Publish-CTA", () => {
    const draft = prepareVisualArtifactDraftFromAi({
      context: ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE,
      raw_output: ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_VALID,
    });
    render(<VisualAiDraftReviewPanel draft={draft} />);
    const cta = screen.getByTestId("vlo-ai-draft-publish-cta") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute("aria-disabled")).toBe("true");
  });

  it("29. Admin-Komponente enthält keine Service-Key-/LLM-Aufrufmuster", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/admin/visual-learning/VisualAiDraftReviewPanel.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/SERVICE_ROLE/);
    expect(src).not.toMatch(/lovable-?api-?key/i);
    expect(src).not.toMatch(/openai/i);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/@\/integrations\/supabase/);
  });

  it("30. Keine Learner-Komponente importiert AI-Draft-Module", () => {
    const learnerDir = resolve(process.cwd(), "src/components/learning");
    const files = walk(learnerDir);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/visual-learning-os\/ai-draft/.test(src)) offenders.push(f);
      if (/VisualAiDraftReviewPanel/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("31. Keine AI-Draft-Fixture wird learner-visible exportiert", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/visual-learning-os/fixtures.ts"),
      "utf8",
    );
    // AI-Fixtures sind explizit ADMIN_ONLY_*; keine LEARNER_SAFE-AI-Variante.
    expect(src).not.toMatch(/LEARNER_SAFE[A-Z_]*AI/);
  });

  it("32+33. Keine Hex-Farben / Tailwind-Farb-Statusklassen in Cut-6-Komponenten", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/admin/visual-learning/VisualAiDraftReviewPanel.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(
      /\b(?:bg|text|border)-(?:red|green|blue|yellow|orange|purple|pink|amber|emerald|rose)-\d{2,3}\b/,
    );
  });
});
