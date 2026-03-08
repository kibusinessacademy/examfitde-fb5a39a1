import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useProductionWaveTriage(waveId: string | null, status: string | null = null) {
  return useQuery({
    queryKey: ["production-wave-triage", waveId, status],
    enabled: !!waveId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "admin-production-wave-triage",
        {
          body: {
            action: "list",
            wave_id: waveId,
            status,
          },
        },
      );
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });
}

export function useProductionWaveTriageAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      waveItemId,
      action,
    }: {
      waveItemId: string;
      action: "retry" | "resume" | "skip";
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "admin-production-wave-triage",
        {
          body: {
            action,
            wave_item_id: waveItemId,
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-wave-triage"] });
      qc.invalidateQueries({ queryKey: ["production-wave-detail"] });
      qc.invalidateQueries({ queryKey: ["production-wave-status"] });
    },
  });
}
