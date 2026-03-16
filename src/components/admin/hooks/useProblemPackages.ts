import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProblemPackageRow {
  package_id: string;
  package_title: string;
  status: string;
  priority: number | null;
  readiness_band: string;
  readiness_score: number;
  real_progress: number;
  build_progress: number;
  likely_stale_progress: boolean;
  blocker_count: number;
  missing_artifacts: string[];
  dead_ends: string[];
}

export type ProblemFilter = "all" | "stale" | "dead_ends" | "blockers";

export function useProblemPackages() {
  return useQuery({
    queryKey: ["admin", "problem-packages"],
    queryFn: async (): Promise<ProblemPackageRow[]> => {
      // Fetch readiness + blockers in parallel
      const [readinessRes, blockersRes] = await Promise.all([
        (supabase as any)
          .from("ops_package_readiness")
          .select("package_id, package_title, status, priority, readiness_band, readiness_score, real_progress, build_progress, likely_stale_progress, missing_artifacts, dead_ends")
          .gt("total_lessons", 0)
          .order("readiness_score", { ascending: true })
          .limit(50),
        (supabase as any)
          .from("ops_package_blockers")
          .select("package_id, blocker_count")
          .gt("blocker_count", 0),
      ]);

      if (readinessRes.error) throw readinessRes.error;
      if (blockersRes.error) throw blockersRes.error;

      const blockerMap = new Map<string, number>();
      for (const b of blockersRes.data || []) {
        blockerMap.set(b.package_id, b.blocker_count);
      }

      return ((readinessRes.data || []) as any[]).map((r) => ({
        ...r,
        blocker_count: blockerMap.get(r.package_id) ?? 0,
      }));
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
