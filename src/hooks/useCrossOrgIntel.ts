import { useQuery } from "@tanstack/react-query";
import { crossOrg } from "@/lib/berufs-ki/crossOrg";

const opts = { staleTime: 30_000, refetchOnWindowFocus: false } as const;

export const useCrossOrgReadiness = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "readiness", orgId, days], queryFn: () => crossOrg.readiness(orgId!, days), enabled: !!orgId, ...opts });

export const useSiteComparison = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "site", orgId, days], queryFn: () => crossOrg.siteComparison(orgId!, days), enabled: !!orgId, ...opts });

export const useCohortTrends = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "cohorts", orgId, days], queryFn: () => crossOrg.cohortTrends(orgId!, days), enabled: !!orgId, ...opts });

export const useRecoveryEffectiveness = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "recovery", orgId, days], queryFn: () => crossOrg.recovery(orgId!, days), enabled: !!orgId, ...opts });

export const useInterventionImpact = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "interv", orgId, days], queryFn: () => crossOrg.interventions(orgId!, days), enabled: !!orgId, ...opts });

export const useClusterRisk = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "cluster", orgId, days], queryFn: () => crossOrg.clusterRisk(orgId!, days), enabled: !!orgId, ...opts });

export const useOrgQuality = (orgId: string | null, days = 30) =>
  useQuery({ queryKey: ["xo", "quality", orgId, days], queryFn: () => crossOrg.orgQuality(orgId!, days), enabled: !!orgId, ...opts });
