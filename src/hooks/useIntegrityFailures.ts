import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useIntegrityFailures() {
  return useQuery({
    queryKey: ["admin-integrity-failures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_track_control" as any)
        .select("*")
        .neq("integrity_passed", true)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
