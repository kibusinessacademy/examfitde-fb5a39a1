/**
 * Handbook module types — derived from DB schema (handbook_* tables)
 * SSOT: src/integrations/supabase/types.ts
 */
import type { Json } from '@/integrations/supabase/types';

// ── Allowed enum unions (drift protection) ──

export type ExerciseType = 'reflection' | 'decision' | 'analysis' | 'structure' | 'self_check';
export type ContentType = 'text' | 'checklist' | 'tip' | 'warning' | 'example' | 'quote';
export type ContentTier = 'basis' | 'expanded';
export type ExpandStatus = 'pending' | 'expanding' | 'done' | 'failed_soft' | 'not_ready';

export type HandbookIcon =
  | 'building-2' | 'brain' | 'target' | 'alert-triangle'
  | 'mic' | 'calendar-check' | 'book-open';

// ── Table interfaces (explicit fields, no select('*')) ──

export interface HandbookChapter {
  id: string;
  chapter_key: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  icon: string | null;
  sort_order: number;
  estimated_reading_minutes: number | null;
  is_premium: boolean | null;
  is_published: boolean | null;
  curriculum_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Fields selected in chapter list queries (lightweight) */
export const CHAPTER_LIST_FIELDS =
  'id, chapter_key, title, subtitle, description, icon, sort_order, estimated_reading_minutes, is_premium, is_published, curriculum_id' as const;

/** Fields selected in chapter detail queries */
export const CHAPTER_DETAIL_FIELDS =
  'id, chapter_key, title, subtitle, description, icon, sort_order, estimated_reading_minutes, is_premium, is_published, curriculum_id, created_at, updated_at' as const;

export interface HandbookSection {
  id: string;
  chapter_id: string;
  section_key: string;
  title: string;
  content_markdown: string;
  content_type: string | null;
  sort_order: number;
  content_tier: string | null;
  quality_score: number | null;
  learning_field_id: string | null;
  competency_id: string | null;
}

/** Fields selected for section content display */
export const SECTION_DISPLAY_FIELDS =
  'id, chapter_id, section_key, title, content_markdown, content_type, sort_order, content_tier, quality_score' as const;

export interface HandbookExercise {
  id: string;
  chapter_id: string;
  section_id: string | null;
  exercise_type: string;
  question_text: string;
  hint_text: string | null;
  explanation_text: string | null;
  example_answer: string | null;
  sort_order: number;
  is_active: boolean | null;
}

export const EXERCISE_FIELDS =
  'id, chapter_id, section_id, exercise_type, question_text, hint_text, explanation_text, example_answer, sort_order, is_active' as const;

export interface HandbookExerciseResponse {
  id: string;
  user_id: string;
  exercise_id: string;
  response_text: string | null;
  self_rating: number | null;
  responded_at: string | null;
}

export const EXERCISE_RESPONSE_FIELDS =
  'id, user_id, exercise_id, response_text, self_rating, responded_at' as const;

export interface HandbookProgress {
  id: string;
  user_id: string;
  chapter_id: string;
  started_at: string | null;
  completed_at: string | null;
  reading_time_minutes: number | null;
  last_section_id: string | null;
}

export const PROGRESS_FIELDS =
  'id, user_id, chapter_id, started_at, completed_at, reading_time_minutes, last_section_id' as const;

export interface HandbookRecommendation {
  id: string;
  chapter_id: string;
  trigger_type: string;
  recommendation_text: string;
  priority: number | null;
  is_active: boolean | null;
  trigger_condition: Json | null;
  chapter?: HandbookChapter;
}
