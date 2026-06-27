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

  it('renders competency label when provided', () => {
    renderHeader({ competencyTitle: 'Beschaffung optimieren', competencyCode: 'K2.1' });
    expect(screen.getByLabelText('Kompetenz').textContent).toContain('K2.1');
    expect(screen.getByLabelText('Kompetenz').textContent).toContain('Beschaffung optimieren');
  });

  it('renders step chip from STEP_CONFIG', () => {
    renderHeader({ stepKey: 'anwenden' });
    const chip = screen.getByTestId('lesson-hero-step-chip');
    expect(chip.textContent).toMatch(/Schritt\s*3\s*\/\s*7/);
    expect(chip.textContent).toContain('Anwenden');
  });

  it('renders image when imageUrl is provided (image path)', () => {
    renderHeader({ imageUrl: 'https://example.test/lesson.jpg' });
    const slot = screen.getByTestId('lesson-hero-image-slot');
    expect(slot.getAttribute('data-has-image')).toBe('true');
    expect(slot.querySelector('img')?.getAttribute('src')).toBe('https://example.test/lesson.jpg');
  });

  it('renders gradient-only fallback when imageUrl is missing (no layout shift)', () => {
    renderHeader({ imageUrl: null });
    const slot = screen.getByTestId('lesson-hero-image-slot');
    expect(slot.getAttribute('data-has-image')).toBe('false');
    expect(slot.querySelector('img')).toBeNull();
    // Reserved height must remain so layout does not shift when image arrives.
    expect(slot.className).toMatch(/h-20/);
  });
});
