/**
 * Handbook hooks — barrel export
 */
export type {
  HandbookChapter,
  HandbookSection,
  HandbookExercise,
  HandbookExerciseResponse,
  HandbookProgress,
  HandbookRecommendation,
  ExerciseType,
  ContentType,
  ContentTier,
  ExpandStatus,
  HandbookIcon,
} from './types';

export {
  CHAPTER_LIST_FIELDS,
  CHAPTER_DETAIL_FIELDS,
  SECTION_DISPLAY_FIELDS,
  EXERCISE_FIELDS,
  EXERCISE_RESPONSE_FIELDS,
  PROGRESS_FIELDS,
} from './types';

export { useHandbookChapters, useHandbookChapter } from './useHandbookChapters';
export { useHandbookProgress, useUpdateHandbookProgress } from './useHandbookProgress';
export { useExerciseResponses, useSaveExerciseResponse } from './useHandbookExercises';
export { useHandbookRecommendations } from './useHandbookRecommendations';
