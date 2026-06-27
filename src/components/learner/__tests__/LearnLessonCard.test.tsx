import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { LearnLessonCard } from '../LearnLessonCard';

describe('<LearnLessonCard /> — ExamFit Card v1 standard', () => {
  it('renders header, question, task and optional hint (collapsible, default closed)', () => {
    render(
      <LearnLessonCard
        header="AI-Tutor zur Lektion"
        question="Wie wird der § 433 BGB ausgelegt?"
        task="Erkläre den Anwendungsbereich kurz und prägnant."
        hint="Denk an Kaufvertrag-Pflichten beider Parteien."
      />,
    );

    expect(screen.getByTestId('learn-lesson-header')).toHaveTextContent(/AI-Tutor/);
    expect(screen.getByTestId('learn-lesson-question')).toHaveTextContent(/§ 433/);
    expect(screen.getByTestId('learn-lesson-task')).toHaveTextContent(/Anwendungsbereich/);

    // hint collapsed by default
    expect(screen.queryByTestId('learn-lesson-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('learn-lesson-hint-toggle'));
    expect(screen.getByTestId('learn-lesson-hint')).toHaveTextContent(/Kaufvertrag/);
  });

  it('keeps answer-surface slot visible (LIF mount point) when supplied', () => {
    render(
      <LearnLessonCard
        header="Step"
        answerSurface={<div data-testid="dummy-lif">LIF here</div>}
      />,
    );
    // Slot wrapper exists and the inner answer surface is visible (mobile-first invariant).
    expect(screen.getByTestId('learn-lesson-answer-slot')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-lif')).toBeVisible();
  });

  it('renders bottom-actions in stable order: back · save · check · next', () => {
    const noop = vi.fn();
    render(
      <LearnLessonCard
        header="Step"
        // intentionally scrambled input order — component must re-order
        actions={[
          { kind: 'next', onClick: noop },
          { kind: 'back', onClick: noop },
          { kind: 'check', onClick: noop },
          { kind: 'save', onClick: noop },
        ]}
      />,
    );

    const bar = screen.getByTestId('learn-lesson-actions');
    const order = Array.from(bar.querySelectorAll('button[data-action]')).map(
      (el) => el.getAttribute('data-action'),
    );
    expect(order).toEqual(['back', 'save', 'check', 'next']);
  });

  it('renders status badge with the requested semantic token (no hex)', () => {
    render(<LearnLessonCard header="Step" status="recommendation" />);
    const badge = screen.getByTestId('learn-lesson-status');
    expect(badge).toHaveAttribute('data-status', 'recommendation');
    // ensure we route through semantic tokens (no raw hex sneaking in)
    expect(badge.className).toMatch(/status-recommendation/);
  });

  it('renders progress (bar + "Frage X von Y" + dots when total <= 8)', () => {
    render(
      <LearnLessonCard
        header="Step"
        progress={{ current: 3, total: 5, showPercent: true }}
      />,
    );
    const prog = screen.getByTestId('learn-lesson-progress');
    expect(prog).toHaveTextContent(/Frage\s*3\s*von\s*5/);
    expect(screen.getByTestId('learn-lesson-progress-percent')).toHaveTextContent('60%');
    expect(screen.getByTestId('learn-lesson-progress-dots')).toBeInTheDocument();

    // bar has correct ARIA progress value
    const bar = prog.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });

  it('hides dots when total exceeds 8 (mobile-first: keep card uncluttered)', () => {
    render(
      <LearnLessonCard header="Step" progress={{ current: 2, total: 12 }} />,
    );
    expect(screen.queryByTestId('learn-lesson-progress-dots')).toBeNull();
  });
});
