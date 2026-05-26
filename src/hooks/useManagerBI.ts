import { useQuery } from "@tanstack/react-query";
import { managerBI } from "@/lib/berufs-ki/bi";

const stale = 30_000;
const qopts = { staleTime: stale, refetchOnWindowFocus: false } as const;

export const useTeamReadinessHeatmap = (orgId: string | null, days = 30) =>
  useQuery({
    queryKey: ["bki-bi", "heatmap", orgId, days],
    queryFn: () => managerBI.heatmap(orgId as string, days),
    enabled: !!orgId,
    ...qopts,
  });

export const useRiskRadar = (orgId: string | null, days = 30) =>
  useQuery({
    queryKey: ["bki-bi", "risk", orgId, days],
    queryFn: () => managerBI.riskRadar(orgId as string, days),
    enabled: !!orgId,
    ...qopts,
  });

export const useTeamAiImpact = (orgId: string | null, days = 30) =>
  useQuery({
    queryKey: ["bki-bi", "impact", orgId, days],
    queryFn: () => managerBI.aiImpact(orgId as string, days),
    enabled: !!orgId,
    ...qopts,
  });

export const useInterventionRecommendations = (orgId: string | null, days = 30) =>
  useQuery({
    queryKey: ["bki-bi", "interventions", orgId, days],
    queryFn: () => managerBI.interventions(orgId as string, days),
    enabled: !!orgId,
    ...qopts,
  });

export const useTrainingQualityScore = (orgId: string | null, days = 30) =>
  useQuery({
    queryKey: ["bki-bi", "quality", orgId, days],
    queryFn: () => managerBI.qualityScore(orgId as string, days),
    enabled: !!orgId,
    ...qopts,
  });
