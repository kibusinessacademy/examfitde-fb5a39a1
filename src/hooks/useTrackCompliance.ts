import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useTrackCompliance() {
  return useQuery({
    queryKey: ["admin-track-compliance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_track_compliance" as any)
        .select("*")
        .order("track_compliant", { ascending: true })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
