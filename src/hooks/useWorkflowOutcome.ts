import { useQuery } from "@tanstack/react-query";
import { fetchOutcomeImpactSummary, fetchWorkflowOutcome } from "@/lib/berufs-ki/outcomes";

export function useWorkflowOutcome(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["berufs-ki", "outcome", runId],
    queryFn: () => fetchWorkflowOutcome(runId as string),
    enabled: !!runId,
    // Trigger berechnet Outcome AFTER run insert — kann minimal verzögert sein.
    refetchInterval: (q) => (q.state.data ? false : 1500),
    refetchOnWindowFocus: false,
  });
}

export function useOutcomeImpactSummary(days = 30) {
  return useQuery({
    queryKey: ["berufs-ki", "outcome-impact", days],
    queryFn: () => fetchOutcomeImpactSummary(days),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
