import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useUpgradeCandidates() {
  return useQuery({
    queryKey: ["admin-upgrade-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_upgrade_candidates" as any)
        .select("*")
        .eq("is_upgrade_candidate", true)
        .order("latest_upgrade_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
