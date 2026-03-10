/**
 * Handbook module types — derived from DB schema (handbook_* tables)
 * SSOT: src/integrations/supabase/types.ts
 */

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

export interface HandbookSection {
  id: string;
  chapter_id: string;
  section_key: string;
  title: string;
  content_markdown: string;
  content_type: string | null;
  sort_order: number;
  content_tier: string | null;
  basis_content: string | null;
  expanded_content: string | null;
  expand_status: string | null;
  quality_score: number | null;
  learning_field_id: string | null;
  competency_id: string | null;
  metadata: Record<string, unknown> | null;
}

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

export interface HandbookExerciseResponse {
  id: string;
  user_id: string;
  exercise_id: string;
  response_text: string | null;
  self_rating: number | null;
  responded_at: string | null;
}

export interface HandbookProgress {
  id: string;
  user_id: string;
  chapter_id: string;
  started_at: string | null;
  completed_at: string | null;
  reading_time_minutes: number | null;
  last_section_id: string | null;
}

export interface HandbookRecommendation {
  id: string;
  chapter_id: string;
  trigger_type: string;
  recommendation_text: string;
  priority: number | null;
  is_active: boolean | null;
  trigger_condition: Record<string, unknown> | null;
  chapter?: HandbookChapter;
}

export type ExerciseType = 'reflection' | 'decision' | 'analysis' | 'structure' | 'self_check';
export type ContentType = 'text' | 'checklist' | 'tip' | 'warning' | 'example' | 'quote';
