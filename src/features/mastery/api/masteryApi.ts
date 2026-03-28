import { supabase } from "@/integrations/supabase/client";

export type MasteryUpdateResult = {
  competency_id: string;
  old_level: string;
  new_level: string;
  score: number;
  level_changed: boolean;
};

export type ReadinessResult = {
  readiness_score: number;
  risk_level: "low" | "medium" | "high";
  mastery_pct: number;
  last_sim_score: number | null;
  mastered: number;
  partial: number;
  weak: number;
  total: number;
  persisted: boolean;
};

export async function updateMasteryFromMiniCheck(params: {
  userId: string;
  competencyId: string;
  curriculumId: string;
  score: number;
}): Promise<MasteryUpdateResult> {
  const { data, error } = await supabase.rpc(
    "update_mastery_from_minicheck" as any,
    {
      p_user_id: params.userId,
      p_competency_id: params.competencyId,
      p_curriculum_id: params.curriculumId,
      p_score: params.score,
    }
  );

  if (error) {
    throw new Error(error.message || "Mastery konnte nicht aktualisiert werden.");
  }

  return data as MasteryUpdateResult;
}

export async function computeReadiness(params: {
  userId: string;
  curriculumId: string;
}): Promise<ReadinessResult> {
  const { data, error } = await supabase.rpc("compute_readiness" as any, {
    p_user_id: params.userId,
    p_curriculum_id: params.curriculumId,
  });

  if (error) {
    throw new Error(error.message || "Readiness konnte nicht berechnet werden.");
  }

  return data as ReadinessResult;
}

export async function fetchWeaknessMap(userId: string, curriculumId: string) {
  const { data, error } = await supabase
    .from("v_user_weakness_map" as any)
    .select("*")
    .eq("user_id", userId)
    .eq("curriculum_id", curriculumId)
    .order("score", { ascending: true });

  if (error) {
    throw new Error(error.message || "Weakness Map konnte nicht geladen werden.");
  }

  return (data ?? []) as Array<{
    competency_id: string;
    competency_title: string;
    learning_field_title: string;
    sort_order: number;
    mastery_level: string;
    score: number;
    attempts: number;
    last_updated: string;
  }>;
}

export async function getAdaptiveExamQuestions(params: {
  userId: string;
  curriculumId: string;
  limit?: number;
}) {
  const { data, error } = await supabase.rpc(
    "get_adaptive_exam_questions" as any,
    {
      p_user_id: params.userId,
      p_curriculum_id: params.curriculumId,
      p_limit: params.limit ?? 40,
    }
  );

  if (error) {
    throw new Error(
      error.message || "Adaptive Prüfungsfragen konnten nicht geladen werden."
    );
  }

  return (data ?? []) as Array<{
    question_id: string;
    competency_id: string;
    difficulty: string;
    mastery_level: string;
    selection_weight: number;
  }>;
}
