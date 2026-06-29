/**
 * Learner Foundation — smoke tests. Pure UI render checks (jsdom).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LearnerCourseCard,
  LearnerHero,
  LearnerProgressPill,
  LearnerSectionHeader,
  LearnerEmptyState,
} from "../index";

describe("Learner foundation components", () => {
  it("LearnerCourseCard rendert Titel + Progress-Pill + primären CTA", () => {
    render(
      <LearnerCourseCard
        title="AEVO Komplettkurs"
        chamber="IHK"
        progress={0.5}
        completedCount={10}
        totalCount={20}
        primaryAction={{ label: "Weiter lernen", href: "/learn/aevo" }}
      />,
    );
    expect(screen.getByText("AEVO Komplettkurs")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /weiter lernen/i })).toBeInTheDocument();
  });

  it("LearnerProgressPill rendert ratio-basierte %", () => {
    render(<LearnerProgressPill progress={0.42} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("LearnerProgressPill liefert nichts ohne Werte", () => {
    const { container } = render(<LearnerProgressPill />);
    expect(container.firstChild).toBeNull();
  });

  it("LearnerSectionHeader rendert Titel + optionalen Eyebrow", () => {
    render(<LearnerSectionHeader eyebrow="Heute" title="Heute fällig" />);
    expect(screen.getByText("Heute fällig")).toBeInTheDocument();
    expect(screen.getByText("Heute")).toBeInTheDocument();
  });

  it("LearnerEmptyState rendert Titel + optionalen CTA", () => {
    render(
      <LearnerEmptyState
        title="Noch keine Kurse"
        description="Stöbere im Shop."
        actionLabel="Zum Shop"
        actionHref="/shop"
      />,
    );
    expect(screen.getByText("Noch keine Kurse")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /zum shop/i })).toBeInTheDocument();
  });

  it("LearnerHero rendert Greeting + KPI-Pills", () => {
    render(
      <LearnerHero
        greeting="Willkommen zurück"
        subtitle="Hier weitermachen"
        kpis={[{ label: "Streak", value: "5 Tage" }]}
      />,
    );
    expect(screen.getByText("Willkommen zurück")).toBeInTheDocument();
    expect(screen.getByText("Streak")).toBeInTheDocument();
    expect(screen.getByText("5 Tage")).toBeInTheDocument();
  });
});
