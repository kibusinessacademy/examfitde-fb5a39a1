/**
 * Heal-Cockpit v8.2 — React Query hooks
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  getHealWorklist,
  getMorningBriefing,
  smartHealBulk,
  type BulkOverrideAction,
} from "./api";
import type { HealWorklistFilters } from "./types";

const POLL_MS = 30_000;

export function useMorningBriefing() {
  return useQuery({
    queryKey: ["heal-cockpit", "briefing"],
    queryFn: getMorningBriefing,
    refetchInterval: POLL_MS,
    staleTime: 15_000,
  });
}

export function useHealWorklist(filters: HealWorklistFilters) {
  return useQuery({
    queryKey: ["heal-cockpit", "worklist", filters],
    queryFn: () => getHealWorklist(filters),
    refetchInterval: POLL_MS,
    staleTime: 15_000,
  });
}

export function useSmartHealBulk() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({
      packageIds,
      action,
    }: {
      packageIds: string[];
      action?: BulkOverrideAction;
    }) => smartHealBulk(packageIds, user?.id ?? null, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "briefing"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "worklist"] });
    },
  });
}
