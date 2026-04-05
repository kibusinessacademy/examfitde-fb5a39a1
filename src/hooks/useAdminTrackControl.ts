import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAdminTrackControl() {
  return useQuery({
    queryKey: ["admin-track-control"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_track_control" as any)
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
