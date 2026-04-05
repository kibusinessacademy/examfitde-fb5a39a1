import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePublishReadiness() {
  return useQuery({
    queryKey: ["admin-publish-readiness"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_publish_readiness" as any)
        .select("*")
        .order("publish_ready", { ascending: true })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
