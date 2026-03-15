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

// Client-side debounce to prevent rapid duplicate snapshot calls
let _lastSnapshotCall: Record<string, number> = {};
const SNAPSHOT_DEBOUNCE_MS = 5_000;

/**
 * Trigger a readiness snapshot + recommendation generation.
 * Debounced client-side (5s) + server-side (30s same-score guard).
 */
export async function snapshotExamReadiness(curriculumId: string) {
  const now = Date.now();
  if (_lastSnapshotCall[curriculumId] && now - _lastSnapshotCall[curriculumId] < SNAPSHOT_DEBOUNCE_MS) {
    console.debug('[snapshotExamReadiness] Debounced (client-side)');
    return null;
  }
  _lastSnapshotCall[curriculumId] = now;

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
