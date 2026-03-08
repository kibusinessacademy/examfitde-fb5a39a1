import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useUnifiedLeitstelleSnapshot() {
  return useQuery({
    queryKey: ["unified-leitstelle-snapshot"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_unified_leitstelle_snapshot");
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 15000,
  });
}

export function useUnifiedLeitstelleFeed(limit = 50) {
  return useQuery({
    queryKey: ["unified-leitstelle-feed", limit],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_unified_leitstelle_feed", {
        p_limit: limit,
      });
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 15000,
  });
}
