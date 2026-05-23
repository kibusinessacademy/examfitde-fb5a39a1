import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MiniCheckTutorFeedback, {
  hasSufficientFeedbackContext,
  buildMiniCheckContextTag,
  type MiniCheckTutorContext,
  type MiniCheckTutorResult,
} from '../MiniCheckTutorFeedback';

const sendMessage = vi.fn();
const setRole = vi.fn();

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
      clearMessages: vi.fn(),
      mode: actual.AI_MODES.LEARNING,
      role: actual.AI_ROLES.FEEDBACK,
      updateContext: vi.fn(),
      suggestedPrompts: [],
    }),
  };
});

const fullCtx: MiniCheckTutorContext = {
  curriculumId: 'cur-1',
  competencyId: 'comp-1',
  lessonId: 'les-1',
  stepKey: 'mini_check',
  competencyCode: 'K01',
  competencyTitle: 'Grundlagen',
};

const passedResult: MiniCheckTutorResult = {
  passed: true,
  scorePercent: 100,
  correct: 4,
  total: 4,
  wrongItems: [],
};

const partialResult: MiniCheckTutorResult = {
  passed: false,
  scorePercent: 50,
  correct: 2,
  total: 4,
  wrongItems: [
    { questionId: 'q1', questionText: 'Frage 1?', selectedText: 'A', correctText: 'B' },
    { questionId: 'q2', questionText: 'Frage 2?', selectedText: 'C', correctText: 'D' },
  ],
};

const failedResult: MiniCheckTutorResult = {
  passed: false,
  scorePercent: 0,
  correct: 0,
  total: 3,
  wrongItems: [
    { questionId: 'qa', questionText: 'F?', selectedText: 'X', correctText: 'Y' },
    { questionId: 'qb', questionText: 'F?', selectedText: 'X', correctText: 'Y' },
    { questionId: 'qc', questionText: 'F?', selectedText: 'X', correctText: 'Y' },
  ],
};

describe('hasSufficientFeedbackContext', () => {
  it('true with full context', () => {
    expect(hasSufficientFeedbackContext(fullCtx)).toBe(true);
  });
  it('false when competency missing', () => {
    expect(hasSufficientFeedbackContext({ ...fullCtx, competencyId: null })).toBe(false);
  });
  it('false when lesson missing', () => {
    expect(hasSufficientFeedbackContext({ ...fullCtx, lessonId: null })).toBe(false);
  });
  it('false when curriculum missing', () => {
    expect(hasSufficientFeedbackContext({ ...fullCtx, curriculumId: null })).toBe(false);
  });
});

describe('buildMiniCheckContextTag', () => {
  it('encodes IDs, score and verdict (passed)', () => {
    const tag = buildMiniCheckContextTag(fullCtx, passedResult);
    expect(tag).toContain('lesson_id=les-1');
    expect(tag).toContain('competency_id=comp-1');
    expect(tag).toContain('step=mini_check');
    expect(tag).toContain('score_percent=100');
    expect(tag).toContain('correct=4/4');
    expect(tag).toContain('verdict=passed');
    expect(tag).not.toContain('wrong_qids=');
  });

  it('encodes wrong qids on partial', () => {
    const tag = buildMiniCheckContextTag(fullCtx, partialResult);
    expect(tag).toContain('verdict=partial');
    expect(tag).toContain('wrong_qids=q1,q2');
  });

  it('uses verdict=failed when score is 0', () => {
    const tag = buildMiniCheckContextTag(fullCtx, failedResult);
    expect(tag).toContain('verdict=failed');
    expect(tag).toContain('wrong_qids=qa,qb,qc');
  });

  it('omits wrong_qids if no wrong items', () => {
    const tag = buildMiniCheckContextTag(fullCtx, passedResult);
    expect(tag).not.toContain('wrong_qids');
  });
});

describe('<MiniCheckTutorFeedback />', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    setRole.mockReset();
  });

  it('renders fail-closed message when context insufficient', () => {
    render(
      <MiniCheckTutorFeedback
        context={{ lessonId: 'les-1' }}
        result={partialResult}
      />,
    );
    expect(screen.getByTestId('minicheck-tutor-fail-closed')).toHaveTextContent(
      /noch keine geprüfte Grundlage/i,
    );
    expect(screen.queryByTestId('minicheck-tutor-actions')).toBeNull();
  });

  it('renders 4 actions on passed (error-only actions disabled)', () => {
    render(<MiniCheckTutorFeedback context={fullCtx} result={passedResult} />);
    const actions = screen.getByTestId('minicheck-tutor-actions');
    const buttons = actions.querySelectorAll('button[data-action]');
    expect(buttons).toHaveLength(4);

    const explainErrors = actions.querySelector(
      'button[data-action="explain_errors"]',
    ) as HTMLButtonElement;
    const exampleFalle = actions.querySelector(
      'button[data-action="exam_pitfall"]',
    ) as HTMLButtonElement;
    expect(explainErrors).toBeDisabled();
    expect(exampleFalle).toBeDisabled();
    expect(explainErrors.getAttribute('data-disabled-reason')).toBe('no_wrong_answers');
  });

  it('enables error-only actions on partial result', () => {
    render(<MiniCheckTutorFeedback context={fullCtx} result={partialResult} />);
    const explainErrors = screen.getByRole('button', { name: /erkläre meine fehler/i });
    expect(explainErrors).not.toBeDisabled();
  });

  it('sends prompt with structured minicheck_context tag (failed)', () => {
    render(<MiniCheckTutorFeedback context={fullCtx} result={failedResult} />);
    fireEvent.click(screen.getByRole('button', { name: /erkläre meine fehler/i }));

    expect(setRole).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const payload = sendMessage.mock.calls[0][0] as string;
    expect(payload).toContain('[minicheck_context:');
    expect(payload).toContain('lesson_id=les-1');
    expect(payload).toContain('competency_id=comp-1');
    expect(payload).toContain('verdict=failed');
    expect(payload).toContain('wrong_qids=qa,qb,qc');
    expect(payload).toContain('score_percent=0');
  });

  it('does not call sendMessage when context insufficient', () => {
    render(
      <MiniCheckTutorFeedback context={{ lessonId: 'les-1' }} result={partialResult} />,
    );
    expect(screen.queryByRole('button', { name: /erkläre meine fehler/i })).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
