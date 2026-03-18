import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PackageEffectiveState = {
  package_id: string;
  effective_quality_gate_state: "passed" | "failed" | "pending";
  should_show_pass_banner: boolean;
  should_show_fail_banner: boolean;
  autofix_allowed: boolean;
  competency_coverage_pct: number;
  approved_questions: number;
  oral_blueprints: number;
  handbook_sections: number;
  tutor_indices: number;
  competencies_total: number;
  competencies_covered: number;
  package_status: string;
  integrity_passed: boolean | null;
  build_progress: number | null;
};

export function usePackageEffectiveState(packageId?: string) {
  return useQuery({
    queryKey: ["package-effective-state", packageId],
    queryFn: async () => {
      if (!packageId) return null;
      const { data, error } = await (supabase as any)
        .from("ops_package_effective_state_v1")
        .select("*")
        .eq("package_id", packageId)
        .single();
      if (error) throw error;
      return data as PackageEffectiveState;
    },
    enabled: !!packageId,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}
