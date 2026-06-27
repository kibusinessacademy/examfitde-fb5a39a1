import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardHero } from '../DashboardHero';

function renderHero(props: Parameters<typeof DashboardHero>[0]) {
  return render(
    <MemoryRouter>
      <DashboardHero {...props} />
    </MemoryRouter>,
  );
}

describe('Wave 3 · <DashboardHero />', () => {
  it('greets with provided name', () => {
    renderHero({ name: 'Mia', readinessPct: 42 });
    expect(screen.getByText(/Willkommen zurück, Mia/i)).toBeInTheDocument();
  });

  it('falls back to "Lernende:r" when name is empty', () => {
    renderHero({ name: null, readinessPct: 0 });
    expect(screen.getByText(/Willkommen zurück, Lernende:r/i)).toBeInTheDocument();
  });

  it('renders next-goal label and continue CTA when goal is provided', () => {
    renderHero({
      name: 'Mia',
      nextGoalLabel: 'Lerne BWL · Marketing-Mix',
      nextGoalHref: '/app/lernpfad?lesson=42',
    });
    expect(screen.getByTestId('dashboard-hero-next-goal')).toHaveTextContent(
      /Lerne BWL · Marketing-Mix/i,
    );
    const cta = screen.getByTestId('dashboard-hero-cta');
    expect(cta).toBeInTheDocument();
    expect(cta.querySelector('a')?.getAttribute('href')).toBe('/app/lernpfad?lesson=42');
  });

  it('shows "Beruf wählen" CTA when no next goal exists', () => {
    renderHero({ name: 'Mia', nextGoalLabel: null, nextGoalHref: null });
    const cta = screen.getByTestId('dashboard-hero-cta');
    expect(cta.querySelector('a')?.getAttribute('href')).toBe('/berufe');
    expect(cta).toHaveTextContent(/Beruf wählen/i);
  });

  it('shows context chip when contextLabel is set', () => {
    renderHero({ name: 'Mia', contextLabel: 'Automatenfachmann/-frau' });
    expect(screen.getByText(/Automatenfachmann\/-frau/i)).toBeInTheDocument();
  });

  it('renders readiness ring with clamped percentage', () => {
    renderHero({ name: 'Mia', readinessPct: 188 });
    const readiness = screen.getByTestId('dashboard-hero-readiness');
    expect(readiness).toBeInTheDocument();
    // ProgressMeter ring announces "Prüfungsreife 100 Prozent" via aria-label
    expect(readiness.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('has a primary CTA with min-h-11 touch target', () => {
    renderHero({ name: 'Mia', nextGoalLabel: 'X', nextGoalHref: '/x' });
    const cta = screen.getByTestId('dashboard-hero-cta');
    // Button wrapper carries the size classes
    expect(cta.className).toMatch(/min-h-11/);
  });
});
