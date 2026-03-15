import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ReadinessSnapshot {
  id: string;
  readiness_score: number;
  risk_level: string;
  confidence_score: number;
  based_on_competencies: number;
  mastered_count: number;
  partial_count: number;
  not_mastered_count: number;
  last_exam_sim_score: number | null;
  weak_competencies: Array<{ competency_id: string; title: string; code: string; score: number }>;
  strong_competencies: Array<{ competency_id: string; title: string; code: string; score: number }>;
  calculated_at: string;
}

export function useReadinessSnapshot(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["readiness-snapshot", user?.id, curriculumId],
    queryFn: async (): Promise<ReadinessSnapshot | null> => {
      if (!user || !curriculumId) return null;

      const { data, error } = await (supabase as any)
        .from("v_user_current_readiness")
        .select("*")
        .eq("user_id", user.id)
        .eq("curriculum_id", curriculumId)
        .maybeSingle();

      if (error) throw error;
      return data as ReadinessSnapshot | null;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 5,
  });
}

export interface TopGap {
  competency_id: string;
  competency_title: string;
  competency_code: string;
  learning_field_code: string;
  learning_field_title: string;
  mastery_score: number | null;
  mastery_state: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy_pct: number;
  gap_type: string;
  weakness_score: number;
}

export function useTopGaps(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["top-gaps", user?.id, curriculumId],
    queryFn: async (): Promise<TopGap[]> => {
      if (!user || !curriculumId) return [];

      const { data, error } = await (supabase as any)
        .from("v_user_top_gaps")
        .select("*")
        .eq("user_id", user.id)
        .eq("curriculum_id", curriculumId)
        .order("weakness_score", { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data || []) as TopGap[];
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 5,
  });
}

export interface UserRecommendation {
  id: string;
  curriculum_id: string;
  recommendation_type: string;
  target_id: string | null;
  target_meta: Record<string, unknown>;
  reason_code: string;
  reason_text: string;
  priority_score: number;
  generated_at: string;
  expires_at: string | null;
}

export function useActiveRecommendations(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["active-recommendations", user?.id, curriculumId],
    queryFn: async (): Promise<UserRecommendation[]> => {
      if (!user || !curriculumId) return [];

      const { data, error } = await (supabase as any)
        .from("v_user_active_recommendations")
        .select("*")
        .eq("user_id", user.id)
        .eq("curriculum_id", curriculumId)
        .limit(5);

      if (error) throw error;
      return (data || []) as UserRecommendation[];
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 5,
  });
}

export interface ReadinessTrendPoint {
  readiness_score: number;
  risk_level: string;
  mastered_count: number;
  calculated_at: string;
}

export function useReadinessTrend(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["readiness-trend", user?.id, curriculumId],
    queryFn: async (): Promise<ReadinessTrendPoint[]> => {
      if (!user || !curriculumId) return [];

      const { data, error } = await (supabase as any)
        .from("v_user_readiness_trend")
        .select("readiness_score, risk_level, mastered_count, calculated_at")
        .eq("user_id", user.id)
        .eq("curriculum_id", curriculumId)
        .order("calculated_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      return (data || []) as ReadinessTrendPoint[];
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 5,
  });
}
