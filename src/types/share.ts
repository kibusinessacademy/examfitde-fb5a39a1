export type ShareEventType =
  | 'exam_session_completed_high_score'
  | 'exam_session_improvement_milestone'
  | 'hard_question_correct'
  | 'competency_mastered'
  | 'streak_milestone';

export type ShareEventStatus = 'eligible' | 'dismissed' | 'shared' | 'expired';

export interface ShareEvent {
  id: string;
  user_id: string;
  curriculum_id: string | null;
  competency_id: string | null;
  exam_session_id: string | null;
  exam_question_id: string | null;
  event_type: ShareEventType;
  event_status: ShareEventStatus;
  score_percent: number | null;
  delta_percent: number | null;
  difficulty_level: string | null;
  rarity_percent: number | null;
  streak_days: number | null;
  mastery_before: string | null;
  mastery_after: string | null;
  title: string;
  subtitle: string | null;
  share_payload: Record<string, unknown>;
  created_at: string;
  consumed_at: string | null;
}
