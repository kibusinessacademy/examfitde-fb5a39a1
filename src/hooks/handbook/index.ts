/**
 * Handbook hooks — barrel export
 * Each hook is in its own file for maintainability.
 */
export * from './types';
export { useHandbookChapters, useHandbookChapter } from './useHandbookChapters';
export { useHandbookProgress, useUpdateHandbookProgress } from './useHandbookProgress';
export { useExerciseResponses, useSaveExerciseResponse } from './useHandbookExercises';
export { useHandbookRecommendations } from './useHandbookRecommendations';
