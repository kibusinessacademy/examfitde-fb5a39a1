import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCohortOverview(curriculumId: string | null, organizationId?: string) {
  return useQuery({
    queryKey: ["cohort-overview", curriculumId, organizationId],
    enabled: !!curriculumId,
    queryFn: async () => {
      const args: { p_curriculum_id: string; p_organization_id?: string } = { p_curriculum_id: curriculumId! };
      if (organizationId) args.p_organization_id = organizationId;
      const { data, error } = await supabase.rpc("get_cohort_competency_overview", args);
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

export function useOrgCompetencyDashboard(organizationId: string | null) {
  return useQuery({
    queryKey: ["org-competency-dashboard", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_org_competency_dashboard", {
        p_organization_id: organizationId!,
      });
      if (error) throw error;
      return data as any;
    },
  });
}

export function useB2bCurricula() {
  return useQuery({
    queryKey: ["b2b-curricula"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_b2b_curricula");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
}

export function useB2bOrgList() {
  return useQuery({
    queryKey: ["b2b-org-list"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-org-console-context`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`Org context failed: ${res.status}`);
      const json = await res.json();
      return (json.orgs ?? []) as { id: string; name: string; org_type: string; my_role: string }[];
    },
  });
}
