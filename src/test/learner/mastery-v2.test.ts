import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

/**
 * S2 Mastery v2 — anon contract:
 * - learner_get_mastery_summary requires auth → refuses anon
 * - learner_next_best_step requires auth → refuses anon
 * - update_mastery_from_attempt: anon cannot mutate someone else's state
 *   (RLS + SECURITY DEFINER guard on auth.uid() = p_user_id)
 */
describe("S2 Mastery v2 — anon contract", () => {
  const fakeUser = "00000000-0000-0000-0000-000000000001";
  const fakeCourse = "00000000-0000-0000-0000-000000000002";
  const fakeComp = "00000000-0000-0000-0000-000000000003";

  it("learner_get_mastery_summary refuses anon", async () => {
    const { error } = await supabase.rpc("learner_get_mastery_summary" as any, {
      p_course_id: fakeCourse,
    });
    expect(error).toBeTruthy();
  });

  it("learner_next_best_step refuses anon", async () => {
    const { error } = await supabase.rpc("learner_next_best_step" as any, {
      p_course_id: fakeCourse,
    });
    expect(error).toBeTruthy();
  });

  it("update_mastery_from_attempt refuses anon writing for another user", async () => {
    const { error } = await supabase.rpc("update_mastery_from_attempt" as any, {
      p_user_id: fakeUser,
      p_course_id: fakeCourse,
      p_competency_id: fakeComp,
      p_correct: true,
      p_response_ms: 1000,
      p_event_type: "quiz",
      p_question_id: null,
      p_misconception_tags: [],
    });
    expect(error).toBeTruthy();
  });

  it("learner_competency_state direct read is RLS-locked for anon", async () => {
    const { data } = await supabase.from("learner_competency_state" as any).select("*").limit(1);
    // Anon read returns no rows (RLS), no error needed
    expect(Array.isArray(data) ? data.length : 0).toBe(0);
  });
});
