import { useQuery } from "@tanstack/react-query";
import {
  getNextBestSkillActions,
  getTutorGraphContext,
  getGraphWorkflowRecommendations,
  getManagerRiskExplanations,
  getExamFitGraphBridge,
} from "@/lib/berufs-ki/graphActivation";

export function useNextBestSkillActions(limit = 5) {
  return useQuery({
    queryKey: ["graph-activation", "skill-actions", limit],
    queryFn: () => getNextBestSkillActions(limit),
    staleTime: 60_000,
  });
}

export function useTutorGraphContext(args: { competencyId?: string; lessonId?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: ["graph-activation", "tutor-context", args.competencyId ?? null, args.lessonId ?? null],
    queryFn: () => getTutorGraphContext(args),
    enabled: (args.enabled ?? true) && Boolean(args.competencyId || args.lessonId),
    staleTime: 60_000,
  });
}

export function useGraphWorkflowRecommendations(limit = 5) {
  return useQuery({
    queryKey: ["graph-activation", "workflow-recos", limit],
    queryFn: () => getGraphWorkflowRecommendations(limit),
    staleTime: 60_000,
  });
}

export function useManagerRiskExplanations(windowDays = 30) {
  return useQuery({
    queryKey: ["graph-activation", "manager-risk", windowDays],
    queryFn: () => getManagerRiskExplanations(windowDays),
    staleTime: 60_000,
  });
}

export function useExamFitGraphBridge(certificationId: string | null | undefined) {
  return useQuery({
    queryKey: ["graph-activation", "examfit-bridge", certificationId],
    queryFn: () => getExamFitGraphBridge(certificationId as string),
    enabled: Boolean(certificationId),
    staleTime: 60_000,
  });
}
