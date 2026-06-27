import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LearningDashboardGrid } from '../LearningDashboardGrid';

function renderGrid(props: React.ComponentProps<typeof LearningDashboardGrid> = {}) {
  return render(
    <MemoryRouter>
      <LearningDashboardGrid {...props} />
    </MemoryRouter>,
  );
}

describe('LearningDashboardGrid (DS2.0)', () => {
  it('renders 4 ImageCards + 2 Hero panels (6 total tiles)', () => {
    renderGrid({ overallProgress: 42, topWeaknesses: ['Beschaffung', 'Marketing'] });
    expect(screen.getAllByTestId('examfit-image-card').length).toBe(4);
    expect(screen.getByTestId('dashboard-progress-card')).toBeTruthy();
    expect(screen.getByTestId('dashboard-weaknesses-card')).toBeTruthy();
  });

  it('shows empty-state copy when no weaknesses', () => {
    renderGrid();
    const list = screen.getByTestId('dashboard-weaknesses-list');
    expect(list.textContent).toMatch(/Noch keine Lücken/);
  });

  it('renders progress ring with given percentage', () => {
    renderGrid({ overallProgress: 67 });
    const rings = screen.getAllByRole('progressbar');
    const ring = rings.find((r) => r.getAttribute('data-shape') === 'ring');
    expect(ring?.getAttribute('aria-valuenow')).toBe('67');
  });
});
