import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PackageReadinessRow {
  package_id: string;
  package_title: string;
  status: string;
  priority: number | null;
  build_progress: number | null;
  integrity_passed: boolean | null;
  council_approved: boolean | null;
  is_published: boolean | null;
  blocked_reason: string | null;
  curriculum_id: string | null;
  total_lessons: number;
  real_lessons: number;
  placeholder_lessons: number;
  materialization_pct: number;
  qc_approved: number;
  qc_tier1_passed: number;
  qc_tier1_failed: number;
  qc_needs_revision: number;
  qc_pending: number;
  qc_approved_pct: number;
  exam_risk_covered: number;
  exam_risk_coverage_pct: number;
  total_competencies: number;
  learner_step_completeness_pct: number;
  readiness_score: number;
  readiness_band: "learner_ready" | "content_heavy" | "building" | "early" | "empty";
  updated_at: string;
}

export interface PackageStepRow {
  package_id: string;
  package_title: string;
  lesson_step: string;
  total_lessons: number;
  real_lessons: number;
  placeholder_lessons: number;
  qc_approved: number;
  qc_tier1_passed: number;
  qc_tier1_failed: number;
  qc_pending: number;
  materialization_pct: number;
}

export interface PackageBlockerRow {
  package_id: string;
  package_title: string;
  status: string;
  priority: number | null;
  readiness_band: string;
  readiness_score: number;
  materialization_pct: number;
  qc_approved_pct: number;
  exam_risk_coverage_pct: number;
  learner_step_completeness_pct: number;
  blocked_reason: string | null;
  blocker_placeholder_heavy: boolean;
  blocker_qc_bottleneck: boolean;
  blocker_step_incomplete: boolean;
  blocker_exam_risk_low: boolean;
  blocker_pipeline_blocked: boolean;
  blocker_count: number;
}

export function usePackageReadiness() {
  return useQuery({
    queryKey: ["admin", "package-readiness"],
    queryFn: async (): Promise<PackageReadinessRow[]> => {
      const { data, error } = await (supabase as any)
        .from("ops_package_readiness")
        .select("*")
        .gt("total_lessons", 0)
        .order("readiness_score", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function usePackageStepReadiness(packageId?: string) {
  return useQuery({
    queryKey: ["admin", "package-step-readiness", packageId],
    queryFn: async (): Promise<PackageStepRow[]> => {
      let q = (supabase as any)
        .from("ops_package_step_readiness")
        .select("*");
      if (packageId) q = q.eq("package_id", packageId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!packageId,
    staleTime: 15_000,
  });
}

export function usePackageBlockers() {
  return useQuery({
    queryKey: ["admin", "package-blockers"],
    queryFn: async (): Promise<PackageBlockerRow[]> => {
      const { data, error } = await (supabase as any)
        .from("ops_package_blockers")
        .select("*")
        .gt("blocker_count", 0)
        .order("blocker_count", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
