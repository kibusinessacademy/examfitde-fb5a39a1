import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LessonHero from '@/components/lesson/LessonHero';

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseProps = {
  rawTitle: 'LF06-K01: Grundlagen von Betriebliches Gesundheitsmanagement verstehen und erklären',
  content: {
    objectives: [
      'BGM in eigenen Worten erklären',
      'Einzelmaßnahmen von systematischem BGM unterscheiden',
    ],
    exam_triggers: ['Betriebliche Gesundheitsförderung', 'Ergonomie'],
  },
  competencyCode: 'LF06-K01',
  competencyTitle: 'Grundlagen von Betriebliches Gesundheitsmanagement verstehen und erklären',
  courseTitle: 'Personalfachkaufmann/-frau IHK',
  step: 'einstieg',
  lessonNumber: 1,
  totalLessons: 15,
  examRelevanceScore: 80,
  isCompleted: true,
};

describe('LessonHero', () => {
  it('strips LF/K prefix from raw title for the visible H1', () => {
    renderWithQueryClient(<LessonHero {...baseProps} />);
    const h1 = screen.getByTestId('lesson-hero-h1');
    expect(h1.textContent).not.toMatch(/^LF06-K01:/);
    expect(h1.textContent).toContain('Grundlagen von Betriebliches Gesundheitsmanagement');
  });

  it('demotes the curriculum code to the meta line', () => {
    renderWithQueryClient(<LessonHero {...baseProps} />);
    expect(screen.getByText(/LF06/)).toBeTruthy();
    expect(screen.getByText(/Kompetenz K01/)).toBeTruthy();
    expect(screen.getByText(/Lektion 1 von 15/)).toBeTruthy();
  });

  it('renders learner objectives from content.objectives only when present', () => {
    const { rerender } = renderWithQueryClient(<LessonHero {...baseProps} />);
    expect(screen.getByTestId('lesson-hero-objectives')).toBeTruthy();
    expect(screen.getByText(/BGM in eigenen Worten erklären/)).toBeTruthy();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LessonHero {...baseProps} content={{}} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('lesson-hero-objectives')).toBeNull();
  });

  it('renders exam relevance label derived from score and exam_triggers', () => {
    renderWithQueryClient(<LessonHero {...baseProps} />);
    const card = screen.getByTestId('lesson-hero-exam-relevance');
    expect(card.textContent).toContain('Hoch');
    expect(card.textContent).toContain('Betriebliche Gesundheitsförderung');
  });

  it('omits exam relevance card when neither score nor triggers exist', () => {
    renderWithQueryClient(
      <LessonHero
        {...baseProps}
        content={{}}
        examRelevanceScore={null}
      />,
    );
    expect(screen.queryByTestId('lesson-hero-exam-relevance')).toBeNull();
  });

  it('shows completed badge inline when lesson is completed', () => {
    renderWithQueryClient(<LessonHero {...baseProps} />);
    expect(screen.getByTestId('lesson-hero-completed')).toBeTruthy();
  });

  it('falls back to competency title if raw title has no LF/K prefix', () => {
    renderWithQueryClient(
      <LessonHero
        {...baseProps}
        rawTitle="LF06-K01:   "
      />,
    );
    expect(screen.getByTestId('lesson-hero-h1').textContent).toContain(
      'Grundlagen von Betriebliches Gesundheitsmanagement',
    );
  });
});
