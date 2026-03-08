import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useProductionWaveDetail(
  waveId: string | null,
  status: string | null = null,
) {
  return useQuery({
    queryKey: ["production-wave-detail", waveId, status],
    enabled: !!waveId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "admin-production-wave-detail",
        {
          body: {
            wave_id: waveId,
            status,
            limit: 500,
          },
        },
      );
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });
}
