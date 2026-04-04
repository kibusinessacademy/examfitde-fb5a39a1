/**
 * tutor/session-manager.ts
 * 
 * Manages persistent AI Tutor sessions and message storage.
 * Service-role only (called from edge function).
 */

export interface CreateSessionParams {
  userId: string;
  curriculumId: string;
  lessonId?: string | null;
  competencyId?: string | null;
  minicheckAttemptId?: string | null;
  examSessionId?: string | null;
  mode: string;
}

/**
 * Find or create an active tutor session for the given context.
 * Reuses existing active session if context matches.
 */
export async function findOrCreateSession(
  supabase: any,
  params: CreateSessionParams,
): Promise<string> {
  // Try to find existing active session with same context
  let query = supabase
    .from('ai_tutor_sessions')
    .select('id')
    .eq('user_id', params.userId)
    .eq('curriculum_id', params.curriculumId)
    .eq('mode', params.mode)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (params.lessonId) query = query.eq('lesson_id', params.lessonId);
  if (params.competencyId) query = query.eq('competency_id', params.competencyId);

  const { data: existing } = await query;

  if (existing?.length) return existing[0].id;

  // Create new session
  const { data: newSession, error } = await supabase
    .from('ai_tutor_sessions')
    .insert({
      user_id: params.userId,
      curriculum_id: params.curriculumId,
      lesson_id: params.lessonId || null,
      competency_id: params.competencyId || null,
      minicheck_attempt_id: params.minicheckAttemptId || null,
      exam_session_id: params.examSessionId || null,
      mode: params.mode,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[session-manager] Failed to create session:', error);
    throw error;
  }

  return newSession.id;
}

/**
 * Save a message pair (user + assistant) to a session
 */
export async function saveMessages(
  supabase: any,
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
  sourceContext: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from('ai_tutor_messages')
    .insert([
      {
        session_id: sessionId,
        role: 'user',
        content: userMessage,
        source_context: sourceContext,
      },
      {
        session_id: sessionId,
        role: 'assistant',
        content: assistantMessage,
        source_context: sourceContext,
      },
    ]);

  if (error) {
    console.error('[session-manager] Failed to save messages:', error);
  }
}

/**
 * Load conversation history from a persistent session
 */
export async function loadSessionHistory(
  supabase: any,
  sessionId: string,
  limit = 20,
): Promise<Array<{ role: string; content: string }>> {
  const { data } = await supabase
    .from('ai_tutor_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data || []).map((m: any) => ({ role: m.role, content: m.content }));
}
