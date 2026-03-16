import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ReadinessSummary {
  total: number;
  learner_ready: number;
  content_heavy: number;
  building: number;
  early: number;
  empty: number;
  stale_count: number;
  top_dead_ends: { kind: string; count: number }[];
  top_blockers: { kind: string; count: number }[];
}

export function useReadinessSummary() {
  return useQuery({
    queryKey: ["admin", "readiness-summary"],
    queryFn: async (): Promise<ReadinessSummary> => {
      const { data: rows, error } = await (supabase as any)
        .from("ops_package_readiness")
        .select("readiness_band, likely_stale_progress, dead_ends, missing_artifacts, total_lessons")
        .gt("total_lessons", 0);
      if (error) throw error;

      const summary: ReadinessSummary = {
        total: 0,
        learner_ready: 0,
        content_heavy: 0,
        building: 0,
        early: 0,
        empty: 0,
        stale_count: 0,
        top_dead_ends: [],
        top_blockers: [],
      };

      const deadEndMap: Record<string, number> = {};
      const blockerMap: Record<string, number> = {};

      for (const r of (rows || []) as any[]) {
        summary.total++;
        const band = r.readiness_band as string;
        if (band in summary) (summary as any)[band]++;
        if (r.likely_stale_progress) summary.stale_count++;

        for (const d of (r.dead_ends || [])) {
          deadEndMap[d] = (deadEndMap[d] || 0) + 1;
        }
        for (const m of (r.missing_artifacts || [])) {
          blockerMap[m] = (blockerMap[m] || 0) + 1;
        }
      }

      summary.top_dead_ends = Object.entries(deadEndMap)
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count);

      summary.top_blockers = Object.entries(blockerMap)
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count);

      return summary;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
