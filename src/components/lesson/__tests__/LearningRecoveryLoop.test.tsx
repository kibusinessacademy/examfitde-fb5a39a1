import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LearningRecoveryLoop, {
  buildRecoveryRecommendation,
} from '../LearningRecoveryLoop';
import type {
  MiniCheckTutorContext,
  MiniCheckTutorResult,
} from '../MiniCheckTutorFeedback';

const fullContext: MiniCheckTutorContext = {
  curriculumId: 'cur-1',
  competencyId: 'comp-1',
  lessonId: 'lesson-1',
  stepKey: 'mini_check',
  competencyCode: 'LF06-K01',
  competencyTitle: 'BGM verstehen',
};

const passedResult: MiniCheckTutorResult = {
  passed: true,
  scorePercent: 100,
  correct: 3,
  total: 3,
  wrongItems: [],
};

const partialResult: MiniCheckTutorResult = {
  passed: false,
  scorePercent: 50,
  correct: 1,
  total: 2,
  wrongItems: [
    { questionId: 'q1', questionText: 'q', selectedText: 's', correctText: 'c' },
  ],
};

const failedResult: MiniCheckTutorResult = {
  passed: false,
  scorePercent: 0,
  correct: 0,
  total: 2,
  wrongItems: [
    { questionId: 'q1', questionText: 'q', selectedText: 's', correctText: 'c' },
    { questionId: 'q2', questionText: 'q', selectedText: 's', correctText: 'c' },
  ],
};

describe('buildRecoveryRecommendation', () => {
  it('passed → shouldShow=false, blockedReason=passed', () => {
    const r = buildRecoveryRecommendation(fullContext, passedResult);
    expect(r.shouldShow).toBe(false);
    expect(r.blockedReason).toBe('passed');
    expect(r.verdict).toBe('passed');
    expect(r.focusSections).toEqual([]);
  });

  it('partial + full context → shouldShow=true, 3 sections in fixed order', () => {
    const r = buildRecoveryRecommendation(fullContext, partialResult);
    expect(r.shouldShow).toBe(true);
    expect(r.verdict).toBe('partial');
    expect(r.focusSections).toEqual(['shortExplanation', 'examPitfall', 'example']);
    expect(r.wrongCount).toBe(1);
  });

  it('failed + full context → shouldShow=true, verdict=failed', () => {
    const r = buildRecoveryRecommendation(fullContext, failedResult);
    expect(r.shouldShow).toBe(true);
    expect(r.verdict).toBe('failed');
    expect(r.focusSections).toEqual(['shortExplanation', 'examPitfall', 'example']);
  });

  it('failed + missing lessonId → shouldShow=false, blockedReason=missing_context', () => {
    const r = buildRecoveryRecommendation(
      { ...fullContext, lessonId: null },
      failedResult,
    );
    expect(r.shouldShow).toBe(false);
    expect(r.blockedReason).toBe('missing_context');
  });

  it('partial + missing curriculumId → blockedReason=missing_context', () => {
    const r = buildRecoveryRecommendation(
      { ...fullContext, curriculumId: null },
      partialResult,
    );
    expect(r.blockedReason).toBe('missing_context');
  });

  it('partial + missing competencyId → blockedReason=missing_context', () => {
    const r = buildRecoveryRecommendation(
      { ...fullContext, competencyId: null },
      partialResult,
    );
    expect(r.blockedReason).toBe('missing_context');
  });
});

describe('<LearningRecoveryLoop />', () => {
  it('passed → renders nothing', () => {
    const { container } = render(
      <LearningRecoveryLoop context={fullContext} result={passedResult} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('failed + missing context → fail-closed message, no CTA', () => {
    render(
      <LearningRecoveryLoop
        context={{ ...fullContext, competencyId: null }}
        result={failedResult}
      />,
    );
    const card = screen.getByTestId('learning-recovery-loop');
    expect(card.getAttribute('data-state')).toBe('missing-context');
    expect(screen.queryByTestId('recovery-cta-repeat')).toBeNull();
  });

  it('partial + full context → renders 3 focus items + CTA', () => {
    render(<LearningRecoveryLoop context={fullContext} result={partialResult} />);
    expect(screen.getByTestId('learning-recovery-loop').getAttribute('data-state')).toBe('ready');
    const list = screen.getByTestId('recovery-focus-list');
    expect(list.querySelectorAll('[data-section-target]').length).toBe(3);
    expect(screen.getByTestId('recovery-cta-repeat')).toBeInTheDocument();
  });

  it('failed → CTA calls onRepeat with first focus section', () => {
    const onRepeat = vi.fn();
    render(
      <LearningRecoveryLoop
        context={fullContext}
        result={failedResult}
        onRepeat={onRepeat}
      />,
    );
    fireEvent.click(screen.getByTestId('recovery-cta-repeat'));
    expect(onRepeat).toHaveBeenCalledWith('shortExplanation');
  });

  it('failed → default CTA scrolls to [data-section] anchor', () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-section', 'shortExplanation');
    const scrollSpy = vi.fn();
    (anchor as any).scrollIntoView = scrollSpy;
    document.body.appendChild(anchor);
    try {
      render(<LearningRecoveryLoop context={fullContext} result={failedResult} />);
      fireEvent.click(screen.getByTestId('recovery-cta-repeat'));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(anchor);
    }
  });

  it('failed → renders verdict label + competency code', () => {
    render(<LearningRecoveryLoop context={fullContext} result={failedResult} />);
    expect(screen.getByText(/Noch nicht bestanden/)).toBeInTheDocument();
    expect(screen.getByText(/LF06-K01/)).toBeInTheDocument();
  });
});
