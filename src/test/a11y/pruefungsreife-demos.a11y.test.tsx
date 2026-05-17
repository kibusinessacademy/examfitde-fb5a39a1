import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe, toHaveNoViolations } from "jest-axe";

import { ReadinessScoreDemo } from "@/components/landing/demos/ReadinessScoreDemo";
import { CompetencyMasteryDemo } from "@/components/landing/demos/CompetencyMasteryDemo";
import { ExamQuestionDemo } from "@/components/landing/demos/ExamQuestionDemo";
import { AiTutorDemo } from "@/components/landing/demos/AiTutorDemo";
import { OralExamDemo } from "@/components/landing/demos/OralExamDemo";
import { DemoGallery } from "@/components/landing/demos/DemoGallery";

import { QuizStartScreen } from "@/components/pruefungsreife/QuizStartScreen";
import { QuizQuestionCard } from "@/components/pruefungsreife/QuizQuestionCard";
import { QuizResultScreen } from "@/components/pruefungsreife/QuizResultScreen";
import { QuizProgressBar } from "@/components/pruefungsreife/QuizProgressBar";
import { QUESTIONS } from "@/components/pruefungsreife/types";

expect.extend(toHaveNoViolations);

// Tracking is fire-and-forget; mock to keep tests pure
vi.mock("@/lib/trackConversionEvent", () => ({
  trackConversionEvent: vi.fn(),
  emitConversionEvent: vi.fn(),
}));

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const noop = () => {};

async function expectClean(container: HTMLElement) {
  const results = await axe(container, {
    rules: {
      // demo decorations may use color contrast at gradient edges; we only
      // gate on critical violations (button/link names, ARIA, labels).
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });
  expect(results).toHaveNoViolations();
}

describe("A11y regression: Marketing demos", () => {
  it("ReadinessScoreDemo", async () => {
    const { container } = render(wrap(<ReadinessScoreDemo />));
    await expectClean(container);
  });
  it("CompetencyMasteryDemo", async () => {
    const { container } = render(wrap(<CompetencyMasteryDemo />));
    await expectClean(container);
  });
  it("ExamQuestionDemo", async () => {
    const { container } = render(wrap(<ExamQuestionDemo />));
    await expectClean(container);
  });
  it("AiTutorDemo", async () => {
    const { container } = render(wrap(<AiTutorDemo />));
    await expectClean(container);
  });
  it("OralExamDemo", async () => {
    const { container } = render(wrap(<OralExamDemo />));
    await expectClean(container);
  });
  it("DemoGallery", async () => {
    const { container } = render(wrap(<DemoGallery />));
    await expectClean(container);
  });
});

describe("A11y regression: Prüfungsreife flow", () => {
  it("QuizStartScreen (no context)", async () => {
    const { container } = render(wrap(<QuizStartScreen onStart={noop} />));
    await expectClean(container);
  });
  it("QuizStartScreen (Beruf-Kontext)", async () => {
    const { container } = render(
      wrap(<QuizStartScreen contextLabel="Bankkaufmann" onStart={noop} />),
    );
    await expectClean(container);
  });
  it("QuizQuestionCard", async () => {
    const { container } = render(
      wrap(
        <QuizQuestionCard
          question={QUESTIONS[0]}
          onAnswer={noop}
          onBack={noop}
          canGoBack={true}
        />,
      ),
    );
    await expectClean(container);
  });
  it("QuizProgressBar exposes progressbar role + value", async () => {
    const { container, getByRole } = render(<QuizProgressBar current={3} total={8} />);
    const bar = getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-label");
    await expectClean(container);
  });
  it("QuizResultScreen (with weakest categories + bundle CTA)", async () => {
    const { container } = render(
      wrap(
        <QuizResultScreen
          score={62}
          weakest={["pruefungspraxis", "zeitmanagement", "wiederholungssystem"]}
          contextLabel="Bankkaufmann"
          bundleTitle="Bankkaufmann Komplettpaket"
          primaryHref="/paket/bankkaufmann"
          secondaryHref="/berufe"
          onPrimary={noop}
          onSecondary={noop}
          onWeaknessClick={noop}
          onReset={noop}
        />,
      ),
    );
    await expectClean(container);
  });
  it("QuizResultScreen (high risk, no context)", async () => {
    const { container } = render(
      wrap(
        <QuizResultScreen
          score={28}
          weakest={["lernstand", "pruefungsangst"]}
          primaryHref="/shop"
          secondaryHref="/berufe"
          onPrimary={noop}
          onSecondary={noop}
          onReset={noop}
        />,
      ),
    );
    await expectClean(container);
  });
});
