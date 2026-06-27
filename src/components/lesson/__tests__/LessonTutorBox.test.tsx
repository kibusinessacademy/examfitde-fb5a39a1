import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import LessonTutorBox, { hasSufficientTutorContext } from '../LessonTutorBox';

const sendMessage = vi.fn();
const setRole = vi.fn();
const clearMessages = vi.fn();

vi.mock('@/hooks/useAITutor', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAITutor')>(
    '@/hooks/useAITutor',
  );
  return {
    ...actual,
    useAITutor: () => ({
      messages: [],
      isLoading: false,
      sendMessage,
      setRole,
      clearMessages,
      mode: actual.AI_MODES.LEARNING,
      role: actual.AI_ROLES.EXPLAINER,
      updateContext: vi.fn(),
      suggestedPrompts: [],
    }),
  };
});

const fullCtx = {
  curriculumId: 'cur-1',
  competencyId: 'comp-1',
  lessonId: 'les-1',
  stepKey: 'verstehen',
  competencyCode: 'K01',
  competencyTitle: 'Grundlagen',
};

describe('hasSufficientTutorContext', () => {
  it('true when lesson + curriculum + competency present', () => {
    expect(hasSufficientTutorContext(fullCtx)).toBe(true);
  });
  it('false when competency missing', () => {
    expect(hasSufficientTutorContext({ ...fullCtx, competencyId: null })).toBe(false);
  });
  it('false when lesson missing', () => {
    expect(hasSufficientTutorContext({ ...fullCtx, lessonId: null })).toBe(false);
  });
  it('false when curriculum missing', () => {
    expect(hasSufficientTutorContext({ ...fullCtx, curriculumId: null })).toBe(false);
  });
  it('false on empty context', () => {
    expect(hasSufficientTutorContext({})).toBe(false);
  });
});

describe('<LessonTutorBox />', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    setRole.mockReset();
    clearMessages.mockReset();
  });

  it('renders fail-closed message when context insufficient', () => {
    render(<LessonTutorBox context={{ lessonId: 'les-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /AI-Tutor/i }));
    expect(screen.getByTestId('lesson-tutor-fail-closed')).toHaveTextContent(
      /noch keine geprüfte Grundlage/i,
    );
    expect(screen.queryByTestId('lesson-tutor-actions')).toBeNull();
  });

  it('exposes 5 learner-facing actions when context sufficient', () => {
    render(<LessonTutorBox context={fullCtx} />);
    fireEvent.click(screen.getByRole('button', { name: /AI-Tutor/i }));
    const actions = screen.getByTestId('lesson-tutor-actions');
    expect(actions.querySelectorAll('button[data-action]')).toHaveLength(5);
  });

  it('sends prompt with embedded lesson context payload', () => {
    render(<LessonTutorBox context={fullCtx} />);
    fireEvent.click(screen.getByRole('button', { name: /AI-Tutor/i }));
    fireEvent.click(screen.getByText('Erklär mir das einfacher'));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const payload = sendMessage.mock.calls[0][0] as string;
    expect(payload).toContain('lesson_id=les-1');
    expect(payload).toContain('competency_id=comp-1');
    expect(payload).toContain('step=verstehen');
    expect(setRole).toHaveBeenCalled();
  });

  it('does not send when context insufficient (fail-closed)', () => {
    render(<LessonTutorBox context={{ lessonId: 'les-1', curriculumId: 'cur-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /AI-Tutor/i }));
    // No action chips rendered → nothing to click; sendMessage stays untouched.
    expect(screen.queryByText('Erklär mir das einfacher')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // EXAMFIT.CARD.SYSTEM.OS.1 — Welle C migration guards
  it('wraps the sufficient-context state in the ExamFit LearnLessonCard standard', () => {
    render(<LessonTutorBox context={fullCtx} />);
    fireEvent.click(screen.getByRole('button', { name: /AI-Tutor/i }));
    // The tutor must be rendered inside the standard learn lesson card.
    expect(screen.getByTestId('lesson-tutor-card')).toBeInTheDocument();
    // Header/task come from the card surface (consistent text-hierarchy).
    expect(screen.getByTestId('learn-lesson-header')).toHaveTextContent(/AI-Tutor/);
    expect(screen.getByTestId('learn-lesson-task')).toHaveTextContent(/Lernhilfe/);
  });

  it('keeps the fail-closed warning soft (no learner hardlock outside paywall)', () => {
    render(<LessonTutorBox context={{ lessonId: 'les-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /AI-Tutor/i }));
    const warning = screen.getByTestId('lesson-tutor-fail-closed');
    expect(warning).toHaveAttribute('role', 'status');
    // explicitly: not a blocking dialog / alert
    expect(warning.getAttribute('role')).not.toBe('alertdialog');
  });
});
