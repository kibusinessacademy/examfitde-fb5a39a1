/**
 * Cut 8 — UI tests for VisualMasteryHint & VisualMasterySignalPanel.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisualMasteryHint } from "../VisualMasteryHint";
import { VisualMasterySignalPanel } from "@/components/admin/visual-learning/VisualMasterySignalPanel";
import {
  VLO_MASTERY_LEARNER_PROJECTION_FIXTURE,
  VLO_MASTERY_ADMIN_PROJECTION_FIXTURE,
} from "@/lib/visual-learning-os/fixtures";

describe("Cut 8 — VisualMasteryHint (learner)", () => {
  it("23+24. renders without DB/HTTP & shows empty state", () => {
    render(<VisualMasteryHint />);
    expect(screen.getByTestId("visual-mastery-hint")).toBeTruthy();
    expect(screen.getByText(/Aktuell liegen noch keine visuellen Lernhinweise vor/i)).toBeTruthy();
  });

  it("25. shows learner-safe hints", () => {
    render(<VisualMasteryHint projection={VLO_MASTERY_LEARNER_PROJECTION_FIXTURE} />);
    expect(screen.getByText(/Achte besonders auf diese typische Verwechslung/i)).toBeTruthy();
  });

  it("26. contains no exam-readiness / pass-fail copy", () => {
    const { container } = render(
      <VisualMasteryHint projection={VLO_MASTERY_LEARNER_PROJECTION_FIXTURE} />,
    );
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).not.toMatch(/prüfungsreif/);
    expect(text).not.toMatch(/bestanden/);
    expect(text).not.toMatch(/nicht bestanden/);
    expect(text).not.toMatch(/draft/);
    expect(text).not.toMatch(/review/);
  });
});

describe("Cut 8 — VisualMasterySignalPanel (admin)", () => {
  it("27. shows evidence and confidence", () => {
    render(<VisualMasterySignalPanel projection={VLO_MASTERY_ADMIN_PROJECTION_FIXTURE} />);
    expect(screen.getByTestId("visual-mastery-signal-panel")).toBeTruthy();
    expect(screen.getByText(/confidence: medium/i)).toBeTruthy();
    expect(screen.getByText(/minicheck_feedback/)).toBeTruthy();
  });

  it("28. contains supplemental note", () => {
    render(<VisualMasterySignalPanel projection={VLO_MASTERY_ADMIN_PROJECTION_FIXTURE} />);
    expect(screen.getByTestId("vlo-mastery-supplemental-note")).toBeTruthy();
    expect(screen.getByText(/ergänzendes Signal/i)).toBeTruthy();
    expect(screen.getByText(/keine alleinige Mastery-Entscheidung/i)).toBeTruthy();
  });
});
