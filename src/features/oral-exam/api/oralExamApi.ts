import { supabase } from "@/integrations/supabase/client";

export type AdaptiveOralPrompt = {
  competency_id: string;
  competency_title: string;
  learning_field_title: string;
  mastery_level: "not_mastered" | "partial" | "mastered";
  prompt_weight: number;
};

export async function getAdaptiveOralExamPrompts(params: {
  userId: string;
  curriculumId: string;
  limit?: number;
}) {
  const { data, error } = await supabase.rpc(
    "get_adaptive_oral_exam_prompts" as any,
    {
      p_user_id: params.userId,
      p_curriculum_id: params.curriculumId,
      p_limit: params.limit ?? 6,
    }
  );

  if (error) {
    throw new Error(
      error.message || "Adaptive Oral-Exam-Prompts konnten nicht geladen werden."
    );
  }

  return (data ?? []) as AdaptiveOralPrompt[];
}
