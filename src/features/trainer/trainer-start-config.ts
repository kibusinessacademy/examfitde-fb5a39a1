import type { TrainerStartPayload, TrainingMode } from '@/types/trainer';

interface BuildInput {
  curriculumId: string;
  berufLabel: string;
  mode: TrainingMode;
}

export function buildTrainerStartPayload(input: BuildInput): TrainerStartPayload {
  const { curriculumId, berufLabel, mode } = input;

  switch (mode) {
    case 'exam':
      return {
        curriculumId,
        berufLabel,
        mode,
        route: 'exam-simulation',
        config: {
          timed: true,
          feedbackMode: 'deferred',
        },
      };

    case 'quick':
      return {
        curriculumId,
        berufLabel,
        mode,
        route: 'drill',
        config: {
          questionCount: 10,
          mixed: true,
          timed: false,
          feedbackMode: 'immediate',
        },
      };

    case 'learn':
    default:
      return {
        curriculumId,
        berufLabel,
        mode: 'learn',
        route: 'inline',
        config: {
          mixed: false,
          timed: false,
          feedbackMode: 'immediate',
        },
      };
  }
}
