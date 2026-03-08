import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PipelineCapacity {
  total_active: number;
  max_packages: number;
  classes: {
    heavy: number;
    medium: number;
    validation: number;
    light: number;
  };
  limits: {
    heavy: number;
    medium: number;
    validation: number;
    light: number;
  };
  snapshot_at: string;
}

export function usePipelineCapacity() {
  return useQuery({
    queryKey: ["pipeline-capacity-snapshot"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_pipeline_capacity_snapshot");
      if (error) throw error;
      return data as PipelineCapacity;
    },
    refetchInterval: 15_000,
  });
}
