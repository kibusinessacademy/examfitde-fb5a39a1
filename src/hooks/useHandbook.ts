/**
 * @deprecated — Use imports from '@/hooks/handbook' instead.
 * Re-exports for backward compatibility.
 */
export type {
  HandbookChapter,
  HandbookSection,
  HandbookExercise,
  HandbookExerciseResponse,
  HandbookProgress,
  HandbookRecommendation,
} from './handbook';

export {
  useHandbookChapters,
  useHandbookChapter,
  useHandbookProgress,
  useUpdateHandbookProgress,
  useExerciseResponses,
  useSaveExerciseResponse,
  useHandbookRecommendations,
} from './handbook';
