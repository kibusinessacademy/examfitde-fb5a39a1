/**
 * Keyboard + Focus-Navigation Regression für Quiz und Marketing-CTAs.
 *
 * Vertrag:
 *  - Tab-Reihenfolge bleibt logisch (Start-Button vor sekundären Affordances).
 *  - Enter UND Space lösen primäre Buttons aus.
 *  - Sichtbarer Fokus (focus-visible Klasse präsent).
 *  - role="radiogroup" + role="radio" auf Antwortoptionen.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { QuizStartScreen } from "@/components/pruefungsreife/QuizStartScreen";
import { QuizQuestionCard } from "@/components/pruefungsreife/QuizQuestionCard";
import { QuizResultScreen } from "@/components/pruefungsreife/QuizResultScreen";
import { QUESTIONS } from "@/components/pruefungsreife/types";

vi.mock("@/lib/trackConversionEvent", () => ({
  trackConversionEvent: vi.fn(),
  emitConversionEvent: vi.fn(),
}));

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe("Keyboard navigation: Quiz", () => {
  it("Start-Button reagiert auf Enter und Space", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(wrap(<QuizStartScreen onStart={onStart} />));
    const btn = screen.getByTestId("quiz-start");
    btn.focus();
    expect(btn).toHaveFocus();
    expect(btn.className).toMatch(/focus-visible/);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("Antwort-Buttons sind eine radiogroup, mit Enter und Space tappbar", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      wrap(
        <QuizQuestionCard
          question={QUESTIONS[0]}
          onAnswer={onAnswer}
          canGoBack={false}
        />,
      ),
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThanOrEqual(4);

    radios[0].focus();
    expect(radios[0]).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(radios[1]).toHaveFocus();
    await user.keyboard(" ");
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer.mock.calls[0][0]).toBe(0);
    expect(onAnswer.mock.calls[1][0]).toBe(1);
  });

  it("Result-Screen exposed eine polite Live-Region für Score", () => {
    render(
      wrap(
        <QuizResultScreen
          score={62}
          weakest={["pruefungspraxis"]}
          primaryHref="/shop"
          secondaryHref="/berufe"
          onPrimary={() => {}}
          onSecondary={() => {}}
          onReset={() => {}}
        />,
      ),
    );
    const live = screen.getByText(/Dein Prüfungsreife-Score/i).closest("header");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-atomic", "true");
  });
});
