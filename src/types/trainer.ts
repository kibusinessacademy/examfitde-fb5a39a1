export type TrainingMode = 'learn' | 'exam' | 'quick';

export type TrainerStartRoute = 'inline' | 'exam-simulation' | 'drill';

export interface TrainerStartPayload {
  curriculumId: string;
  berufLabel: string;
  mode: TrainingMode;
  route: TrainerStartRoute;
  config: {
    questionCount?: number;
    mixed?: boolean;
    timed?: boolean;
    feedbackMode?: 'immediate' | 'deferred';
  };
}
