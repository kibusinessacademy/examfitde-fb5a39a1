import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ForensicLayerData {
  score: number;
  [key: string]: unknown;
}

export interface ForensicHealAction {
  action: string;
  affected: number;
  detail: string;
}

export interface ForensicResult {
  ok: boolean;
  health_score: number;
  severity: "P0" | "P1" | "P2" | "info";
  layers: {
    job: ForensicLayerData;
    step: ForensicLayerData;
    artifact: ForensicLayerData;
    llm: ForensicLayerData;
    wip: ForensicLayerData;
  };
  duration_ms: number;
  heal_actions?: ForensicHealAction[];
}

export function useForensicMonitor() {
  return useQuery<ForensicResult>({
    queryKey: ["forensic-monitor"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("pipeline-forensic-monitor", {
        body: { mode: "scan" },
      });
      if (error) throw error;
      return data as ForensicResult;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useForensicHeal() {
  const qc = useQueryClient();
  return useMutation<ForensicResult>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("pipeline-forensic-monitor", {
        body: { mode: "both" },
      });
      if (error) throw error;
      return data as ForensicResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forensic-monitor"] });
      qc.invalidateQueries({ queryKey: ["pipeline-health"] });
    },
  });
}
