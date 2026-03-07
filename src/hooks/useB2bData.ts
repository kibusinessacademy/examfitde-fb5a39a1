import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCohortOverview(curriculumId: string | null, organizationId?: string) {
  return useQuery({
    queryKey: ["cohort-overview", curriculumId, organizationId],
    enabled: !!curriculumId,
    queryFn: async () => {
      const params: Record<string, string> = { p_curriculum_id: curriculumId! };
      if (organizationId) params.p_organization_id = organizationId;
      const { data, error } = await supabase.rpc("get_cohort_competency_overview", params);
      if (error) throw error;
      return data as any;
    },
  });
}

export function useLearnerProfile(learnerId: string | null, curriculumId: string | null) {
  return useQuery({
    queryKey: ["learner-profile", learnerId, curriculumId],
    enabled: !!learnerId && !!curriculumId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_learner_competency_profile", {
        p_learner_id: learnerId!,
        p_curriculum_id: curriculumId!,
      });
      if (error) throw error;
      return data as any;
    },
  });
}
