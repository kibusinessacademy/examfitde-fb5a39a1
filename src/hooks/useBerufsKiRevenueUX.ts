/**
 * React Query hooks for BK-Act-2 Revenue UX.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchLockedWorkflowPreview,
  fetchWorkflowUpgradeSignal,
  fetchWorkflowUsageSummary,
} from "@/lib/berufs-ki/revenue";

export function useWorkflowUsageSummary(windowDays = 7) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bki-usage-summary", user?.id, windowDays],
    queryFn: () => fetchWorkflowUsageSummary(windowDays),
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useWorkflowUpgradeSignal() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bki-upgrade-signal", user?.id],
    queryFn: () => fetchWorkflowUpgradeSignal(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}

export function useLockedWorkflowPreview(slug: string | null) {
  return useQuery({
    queryKey: ["bki-locked-preview", slug],
    queryFn: () => (slug ? fetchLockedWorkflowPreview(slug) : null),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });
}
