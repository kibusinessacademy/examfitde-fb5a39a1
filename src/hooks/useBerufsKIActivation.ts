import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCopilotBrief, getExecutiveNarrative } from "@/lib/berufs-ki/copilot";
import {
  listAutomationRules, upsertAutomationRule, evaluateOrgAutomation,
  type AutomationRuleKey,
} from "@/lib/berufs-ki/automation";
import { listProductSuites } from "@/lib/berufs-ki/suites";

const opts = { staleTime: 30_000, refetchOnWindowFocus: false } as const;

export function useCopilotBrief(orgId: string | null, days = 7) {
  return useQuery({
    queryKey: ["bki", "copilot", orgId, days],
    queryFn: () => getCopilotBrief(orgId!, days),
    enabled: !!orgId,
    ...opts,
  });
}

export function useExecutiveNarrative(orgId: string | null, days = 30) {
  return useQuery({
    queryKey: ["bki", "narrative", orgId, days],
    queryFn: () => getExecutiveNarrative(orgId!, days),
    enabled: !!orgId,
    ...opts,
  });
}

export function useAutomationRules(orgId: string | null) {
  return useQuery({
    queryKey: ["bki", "automation", orgId],
    queryFn: () => listAutomationRules(orgId!),
    enabled: !!orgId,
    ...opts,
  });
}

export function useUpsertAutomationRule(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ruleKey: AutomationRuleKey; enabled: boolean; params?: Record<string, unknown> }) =>
      upsertAutomationRule(orgId!, v.ruleKey, v.enabled, v.params ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bki", "automation", orgId] }),
  });
}

export function useEvaluateAutomation(orgId: string | null) {
  return useMutation({
    mutationFn: (days = 7) => evaluateOrgAutomation(orgId!, days),
  });
}

export function useProductSuites() {
  return useQuery({
    queryKey: ["bki", "suites"],
    queryFn: listProductSuites,
    staleTime: 5 * 60_000,
  });
}
