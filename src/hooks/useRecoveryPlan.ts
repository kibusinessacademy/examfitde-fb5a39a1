/**
 * P-Completion 2 — Mastery Recovery Plan hook.
 *
 * Bridges SystemConsciousness (signals + risks) + KnowledgeGraph +
 * weak-Kompetenz bridge into a ready-to-render RecoveryPlan.
 */

import { useMemo } from "react";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { useKnowledgeGraph } from "@/hooks/useKnowledgeGraph";
import { resolveWeakKompetenzIds } from "@/lib/recommendations/weak-kompetenz-bridge";
import { buildRecoveryPlan } from "@/lib/recovery/engine";
import type { RecoveryPlan } from "@/lib/recovery/types";
import type { RiskTone } from "@/lib/system/SystemConsciousness";

export function useRecoveryPlan(opts?: { limit?: number }): RecoveryPlan {
  const graph = useKnowledgeGraph();
  const { risks, signals } = useSystemConsciousness();

  return useMemo(() => {
    const risksArray = Object.values(risks);
    const weakIds = resolveWeakKompetenzIds({ graph, risks: risksArray, limit: opts?.limit ?? 4 });
    const tones: RiskTone[] = risksArray.filter((r) => r.tone !== "stable").map((r) => r.tone);
    const aggregateTone: RiskTone | undefined =
      tones.includes("critical") ? "critical" : tones.includes("watch") ? "watch" : undefined;
    return buildRecoveryPlan({
      graph,
      weakKompetenzIds: weakIds,
      signals,
      aggregateTone,
      limit: opts?.limit ?? 4,
    });
  }, [graph, risks, signals, opts?.limit]);
}
