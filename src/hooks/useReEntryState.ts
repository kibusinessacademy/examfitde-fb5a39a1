import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ReEntryState {
  last_session_at: string | null;
  days_since_last: number | null;
  streak_current: number;
  streak_longest: number;
  exam_phase: string;
  days_to_exam: number | null;
  intensity_recommendation: string;
  suggested_action: { key: string; label: string; deeplink: string };
  computed_at: string;
}

export function useReEntryState(curriculumId: string | null | undefined) {
  return useQuery({
    queryKey: ["learner-re-entry-state", curriculumId ?? null],
    enabled: !!curriculumId,
    staleTime: 60_000,
    queryFn: async (): Promise<ReEntryState | null> => {
      const { data, error } = await supabase.rpc("learner_get_re_entry_state", {
        p_curriculum_id: curriculumId,
      });
      if (error) throw error;
      return (data as unknown as ReEntryState) ?? null;
    },
  });
}

export async function trackReEntryEvent(
  eventType:
    | "app_open"
    | "resume_clicked"
    | "push_received"
    | "push_opened"
    | "rescue_accepted"
    | "rescue_dismissed"
    | "reminder_seen"
    | "session_resumed"
    | "streak_recovered"
    | "daily_challenge_started",
  opts: { curriculumId?: string | null; source?: string; payload?: Record<string, unknown> } = {},
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("learner_re_entry_events").insert({
      user_id: user.id,
      curriculum_id: opts.curriculumId ?? null,
      event_type: eventType,
      source: opts.source ?? "web",
      payload: opts.payload ?? {},
    });
  } catch {
    // best-effort
  }
}
