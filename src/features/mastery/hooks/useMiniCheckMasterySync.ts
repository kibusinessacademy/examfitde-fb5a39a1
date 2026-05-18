import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import {
  updateMasteryFromMiniCheck,
  computeReadiness,
  type ReadinessResult,
} from "@/features/mastery/api/masteryApi";

type CompetencyScore = {
  competencyId: string;
  score: number; // 0..1
};

export function useMiniCheckMasterySync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { track } = useTrackGrowthEvent();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastReadiness, setLastReadiness] = useState<ReadinessResult | null>(null);

  const syncMiniCheckResult = useCallback(
    async (params: {
      curriculumId: string;
      competencyScores: CompetencyScore[];
    }) => {
      if (!user) return null;
      if (params.competencyScores.length === 0) return null;

      setIsSyncing(true);
      try {
        for (const item of params.competencyScores) {
          await updateMasteryFromMiniCheck({
            userId: user.id,
            curriculumId: params.curriculumId,
            competencyId: item.competencyId,
            score: item.score,
          });
        }

        const readiness = await computeReadiness({
          userId: user.id,
          curriculumId: params.curriculumId,
        });

        setLastReadiness(readiness);

        queryClient.invalidateQueries({ queryKey: ["mastery-progress"] });
        queryClient.invalidateQueries({ queryKey: ["weakness-map"] });
        queryClient.invalidateQueries({ queryKey: ["readiness"] });
        queryClient.invalidateQueries({ queryKey: ["readiness-snapshot"] });
        queryClient.invalidateQueries({ queryKey: ["readiness-score"] });
        queryClient.invalidateQueries({ queryKey: ["top-gaps"] });

        // Activation Cut 1b — Funnel-Event: MiniCheck abgeschlossen
        try {
          track("minicheck_completed" as any, {
            curriculumId: params.curriculumId,
            metadata: {
              competencies: params.competencyScores.length,
              readiness_score: readiness?.readiness_score ?? null,
              risk_level: readiness?.risk_level ?? null,
            },
          });
        } catch { /* noop */ }

        return readiness;
      } finally {
        setIsSyncing(false);
      }
    },
    [user, queryClient, track]
  );

  return {
    isSyncing,
    lastReadiness,
    syncMiniCheckResult,
  };
}
