import { supabase } from '@/integrations/supabase/client';

/**
 * Record a learning event for telemetry.
 * Lightweight fire-and-forget call.
 */
export async function recordLearningEvent(params: {
  event_type: string;
  course_id?: string;
  curriculum_id?: string;
  lesson_id?: string;
  competency_id?: string;
  event_source?: string;
  duration_seconds?: number;
  score?: number;
  payload?: Record<string, unknown>;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await supabase.functions.invoke('record-learning-event', {
      body: params,
    });
  } catch (err) {
    console.warn('[recordLearningEvent] Failed:', err);
  }
}

/**
 * Trigger a readiness snapshot + recommendation generation.
 */
export async function snapshotExamReadiness(curriculumId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('snapshot-exam-readiness', {
      body: { curriculum_id: curriculumId },
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[snapshotExamReadiness] Failed:', err);
    return null;
  }
}
