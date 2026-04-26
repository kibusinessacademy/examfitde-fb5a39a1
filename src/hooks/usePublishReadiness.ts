import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePublishReadiness() {
  return useQuery({
    queryKey: ["admin-publish-readiness"],
    queryFn: async () => {
      // SSOT: Wrapper-View liefert effective_*-Spalten (Council-Defer-aware).
      // Hauptview v_admin_publish_readiness bleibt Drift-geschützt.
      const { data, error } = await supabase
        .from("v_admin_publish_readiness_effective" as any)
        .select("*")
        .order("effective_publish_ready", { ascending: true })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
