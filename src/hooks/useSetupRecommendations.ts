import { useQuery } from "@tanstack/react-query";
import { collectSignals } from "@/lib/setup/signals";
import { buildRecommendations } from "@/lib/setup/recommendations";

export function useSetupRecommendations(orgId: string | null) {
  return useQuery({
    queryKey: ["setup-recommendations", orgId],
    queryFn: async () => {
      const signals = await collectSignals(orgId);
      const recommendations = buildRecommendations(signals);
      return { signals, recommendations };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
}
