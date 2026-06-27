import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LessonHeroHeader from '../LessonHeroHeader';

function renderHeader(overrides: Partial<React.ComponentProps<typeof LessonHeroHeader>> = {}) {
  return render(
    <MemoryRouter>
      <LessonHeroHeader
        courseId="c-1"
        courseTitle="Industriekaufmann"
        moduleTitle="Beschaffung & Logistik"
        progress={50}
        currentIndex={1}
        totalLessons={4}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('LessonHeroHeader (DS2.0)', () => {
  it('renders inside HeroSurface area="learn"', () => {
    renderHeader();
    const surface = document.querySelector('[data-area="learn"]');
    expect(surface).toBeTruthy();
  });

  it('exposes a progressbar with Lektion X von Y label', () => {
    renderHeader({ currentIndex: 2, totalLessons: 5 });
    const bar = screen.getByRole('progressbar', { name: /Lektion 3 von 5/i });
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });

  it('renders time chip when provided', () => {
    renderHeader({ estimatedTimeLabel: '≈ 8 Min.' });
    expect(screen.getByTestId('lesson-hero-time-chip').textContent).toContain('8 Min');
  });

  it('renders Back and Home navigation', () => {
    renderHeader();
    expect(screen.getByLabelText(/Zurück zum Kurs/i)).toBeTruthy();
    expect(screen.getByLabelText(/Zur Startseite/i)).toBeTruthy();
  });
});
