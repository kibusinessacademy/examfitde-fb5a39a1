import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompetenceImageCard } from '../CompetenceImageCard';

describe('CompetenceImageCard (DS2.0)', () => {
  it.each([
    ['course', 'Kurs öffnen'],
    ['exam', 'Prüfung starten'],
    ['tutor', 'Mit Tutor üben'],
  ] as const)('renders %s mode with correct action label', (mode, label) => {
    render(<CompetenceImageCard mode={mode} title="Test Kompetenz" />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('renders time chip when estimatedTimeLabel is set', () => {
    render(
      <CompetenceImageCard mode="course" title="X" estimatedTimeLabel="20 Min." />,
    );
    expect(screen.getByTestId('competence-time-chip').textContent).toContain('20 Min');
  });

  it('toggles favorite state and calls callback', () => {
    const onFav = vi.fn();
    render(
      <CompetenceImageCard mode="exam" title="X" onToggleFavorite={onFav} />,
    );
    const btn = screen.getByTestId('competence-fav-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(onFav).toHaveBeenCalledWith(true);
  });

  it('uses gradient fallback when no image is provided', () => {
    render(<CompetenceImageCard mode="tutor" title="X" />);
    expect(screen.getByTestId('examfit-image-card-fallback')).toBeTruthy();
  });
});
