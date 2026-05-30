/**
 * Learner Reality Instrumentation (P0-A cut)
 * --------------------------------------------------------------
 * Thin, typed wrapper around the existing `trackEvent` sink
 * (tracking_events) so the dashboard → first-question funnel can
 * be measured without new architecture.
 *
 * Events (kanonisch, NICHT umbenennen):
 *   - dashboard_cta_clicked
 *   - curriculum_picker_opened
 *   - curriculum_selected
 *   - first_lesson_started
 *   - first_question_seen
 *
 * Fire-and-forget. Tracking MUST NEVER block UX.
 */
import { trackEvent } from '@/lib/tracking/track';

export type LearnerRealityEvent =
  | 'dashboard_cta_clicked'
  | 'curriculum_picker_opened'
  | 'curriculum_selected'
  | 'first_lesson_started'
  | 'first_question_seen';

export interface LearnerRealityPayload {
  cta?: string;
  target?: string;
  curriculum_id?: string | null;
  course_id?: string | null;
  source?: string;
  blocked?: boolean;
  reason?: string;
  [key: string]: unknown;
}

export function trackLearnerReality(
  event: LearnerRealityEvent,
  payload: LearnerRealityPayload = {},
): void {
  // Fire-and-forget; trackEvent already swallows errors.
  void trackEvent({
    eventName: event,
    metadata: payload as Record<string, unknown>,
  });
}
